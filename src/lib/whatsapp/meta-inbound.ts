/**
 * Meta Cloud API inbound processing.
 *
 * HMAC, status updates, and template lifecycle stay in the webhook
 * route. This module parses a Meta message (media, interactive tap,
 * reaction) then hands persist + fan-out to `recordInboundMessage`
 * so Meta and Evolution cannot drift.
 */

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getMediaUrl } from '@/lib/whatsapp/meta-api';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  findOrCreateContact,
  findOrCreateConversation,
  recordInboundMessage,
} from '@/lib/whatsapp/inbound-core';

export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  reaction?: { message_id: string; emoji: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  context?: { id: string };
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent.
 */
export async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    console.error('[meta-inbound] lookupInternalIdByMetaId failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 */
export async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string,
) {
  const reaction = message.reaction;
  if (!reaction?.message_id) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId,
  );
  if (!targetInternalId) {
    console.warn(
      '[meta-inbound] reaction target message not found; skipping',
      reaction.message_id,
    );
    return;
  }

  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (delError) {
      console.error('[meta-inbound] reaction delete failed:', delError.message);
    }
    return;
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    );
  if (upsertError) {
    console.error('[meta-inbound] reaction upsert failed:', upsertError.message);
  }
}

export async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string,
): Promise<{
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  interactiveReplyId: string | null;
}> {
  const verifyAndBuildUrl = async (mediaId: string): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken });
      return `/api/whatsapp/media/${mediaId}`;
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  };

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  };

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null };

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        };
      }
      return empty;

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        };
      }
      return empty;

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        };
      }
      return empty;

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        };
      }
      return empty;

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        };
      }
      return empty;

    case 'location':
      if (message.location) {
        const loc = message.location;
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ');
        return { ...empty, contentText: locationText };
      }
      return empty;

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null };

    case 'interactive': {
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        };
      }
      return { ...empty, contentText: '[Interactive reply]' };
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      };
  }
}

export interface ProcessMetaInboundArgs {
  message: WhatsAppMessage;
  contact: { profile: { name: string }; wa_id: string };
  accountId: string;
  configOwnerUserId: string;
  accessToken: string;
  whatsappConfigId: string;
}

/**
 * One Meta inbound message: reactions stay on `message_reactions`;
 * everything else is parsed then recorded through inbound-core.
 */
export async function processMetaInboundMessage(
  args: ProcessMetaInboundArgs,
): Promise<void> {
  const {
    message,
    contact,
    accountId,
    configOwnerUserId,
    accessToken,
    whatsappConfigId,
  } = args;

  if (message.type === 'reaction') {
    const contactOutcome = await findOrCreateContact(
      accountId,
      configOwnerUserId,
      message.from,
      contact.profile.name,
    );
    if (!contactOutcome) return;
    const convResult = await findOrCreateConversation(
      accountId,
      configOwnerUserId,
      contactOutcome.contact.id,
      whatsappConfigId,
    );
    if (!convResult) return;
    if (convResult.created) {
      await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
        conversation_id: convResult.conversation.id,
        contact_id: contactOutcome.contact.id,
      });
    }
    await handleReaction(
      message,
      convResult.conversation.id,
      contactOutcome.contact.id,
    );
    return;
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken);
  void mediaType;

  await recordInboundMessage({
    accountId,
    configOwnerUserId,
    senderPhone: message.from,
    contactName: contact.profile.name,
    contentText,
    mediaUrl,
    contentType: message.type,
    messageId: message.id,
    timestampMs: parseInt(message.timestamp, 10) * 1000,
    whatsappConfigId,
    interactiveReply: interactiveReplyId
      ? {
          reply_id: interactiveReplyId,
          reply_title: contentText ?? '',
        }
      : undefined,
    replyToMetaMessageId: message.context?.id ?? null,
  });
}
