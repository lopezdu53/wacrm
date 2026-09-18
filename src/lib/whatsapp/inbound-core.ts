/**
 * Provider-agnostic inbound-message core.
 *
 * Meta (`/api/whatsapp/webhook`) and Evolution (`/api/whatsapp/evolution/webhook`)
 * both parse their own payload, then call `recordInboundMessage` with
 * already-normalised fields (phone, text, optional media URL, optional
 * button/list tap). Persist + fan-out live here so the two transports
 * cannot drift: find-or-create contact + conversation, insert the
 * message, then Flow runner, automations, AI auto-reply, qualify, and
 * the public webhook dispatcher.
 */

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { canonicalContactKey } from '@/lib/whatsapp/phone-utils';
import {
  findExistingContact,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import {
  isContactOnPayload,
  mergePeerContacts,
  selectMergeableLosers,
} from '@/lib/contacts/merge-peer';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchInboundToQualify } from '@/lib/ai/qualify';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { notifyNewInboundMessage } from '@/lib/pwa/notify-new-message';

/** Content types the `messages.content_type` CHECK constraint allows. */
const ALLOWED_CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

/** Map provider types onto the CHECK-allowed set (stickers are images). */
export function normalizeInboundContentType(raw: string): string {
  if (ALLOWED_CONTENT_TYPES.has(raw)) return raw;
  if (raw === 'sticker') return 'image';
  return 'text';
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
  whatsapp_lid?: string | null;
  whatsapp_username?: string | null;
  [key: string]: unknown;
}

interface ContactOutcome {
  contact: ContactRow;
  wasCreated: boolean;
}

export interface FindOrCreateContactOptions {
  aliases?: string[];
  lid?: string | null;
  username?: string | null;
}

/** Find an account's contact by phone (shared dedupe), or create it. */
export async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  options: FindOrCreateContactOptions = {},
): Promise<ContactOutcome | null> {
  const key = canonicalContactKey(phone);
  if (!key) return null;

  const lookupKeys = [key, ...(options.aliases ?? [])].filter(Boolean);
  const matches: ExistingContact[] = [];
  const seen = new Set<string>();
  for (const lookup of lookupKeys) {
    const hit = await findExistingContact(supabaseAdmin(), accountId, lookup);
    if (
      hit &&
      !seen.has(hit.id) &&
      isContactOnPayload(hit, lookupKeys)
    ) {
      seen.add(hit.id);
      matches.push(hit);
    }
  }

  if (matches.length > 0) {
    const picked = selectMergeableLosers(matches, key, {
      aliases: lookupKeys,
      lid: options.lid,
      username: options.username,
    });
    let existing = picked.survivor;
    if (picked.losers.length > 0) {
      existing = await mergePeerContacts(
        supabaseAdmin(),
        existing,
        picked.losers,
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name && name !== existing.name) patch.name = name;
    if (options.lid && !existing.whatsapp_lid) patch.whatsapp_lid = options.lid;
    if (options.username && !existing.whatsapp_username) {
      patch.whatsapp_username = options.username;
    }
    if (Object.keys(patch).length > 1) {
      await supabaseAdmin()
        .from('contacts')
        .update(patch)
        .eq('id', existing.id);
    }
    return {
      contact: { ...existing, ...patch } as ContactRow,
      wasCreated: false,
    };
  }

  const insertRow: Record<string, unknown> = {
    account_id: accountId,
    user_id: configOwnerUserId,
    phone: key,
    name: name || key,
  };
  if (options.lid) insertRow.whatsapp_lid = options.lid;
  if (options.username) insertRow.whatsapp_username = options.username;

  const { data: newContact, error } = await supabaseAdmin()
    .from('contacts')
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, key);
      if (raced && isContactOnPayload(raced, lookupKeys)) {
        return { contact: raced as ContactRow, wasCreated: false };
      }
      // Unique on whatsapp_lid / username belonging to another row.
      // Create this handle without copying the stolen stamp.
      if (insertRow.whatsapp_lid || insertRow.whatsapp_username) {
        delete insertRow.whatsapp_lid;
        delete insertRow.whatsapp_username;
        const retry = await supabaseAdmin()
          .from('contacts')
          .insert(insertRow)
          .select()
          .single();
        if (!retry.error && retry.data) {
          return { contact: retry.data as ContactRow, wasCreated: true };
        }
        if (retry.error && isUniqueViolation(retry.error)) {
          const { data: byPhone } = await supabaseAdmin()
            .from('contacts')
            .select('*')
            .eq('account_id', accountId)
            .eq('phone', key)
            .maybeSingle();
          if (byPhone) {
            return { contact: byPhone as ContactRow, wasCreated: false };
          }
        }
      }
    }
    console.error('[inbound-core] error creating contact:', error);
    return null;
  }

  return { contact: newContact as ContactRow, wasCreated: true };
}

interface ConversationRow {
  id: string;
  unread_count: number | null;
  [key: string]: unknown;
}

export type LegacyConversationReuse =
  | { action: 'use'; stamp: boolean }
  | { action: 'reject' };

/**
 * A leftover UNIQUE(account, contact) (migration 036) can make creating
 * a second per-number thread fail. Reuse that row only when it has no
 * channel yet (stamp it) or already belongs to this number. Never merge
 * Evolution number B into a thread already stamped for number A — that
 * is the crossed-chat bug.
 */
export function planLegacyConversationReuse(
  existingConfigId: string | null | undefined,
  incomingConfigId: string | null,
): LegacyConversationReuse {
  if (!existingConfigId) {
    return { action: 'use', stamp: Boolean(incomingConfigId) };
  }
  if (!incomingConfigId || existingConfigId === incomingConfigId) {
    return { action: 'use', stamp: false };
  }
  return { action: 'reject' };
}

/**
 * Find the account's oldest conversation for a contact ON A GIVEN CHANNEL,
 * or create one. When `whatsappConfigId` is set, the lookup + dedup are
 * scoped to that channel so the same contact writing to two different
 * numbers gets two conversations (migration 039). When null, behaviour is
 * the legacy per-(account, contact) dedup.
 */
export async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  whatsappConfigId: string | null = null,
): Promise<{ conversation: ConversationRow; created: boolean } | null> {
  const findExisting = () => {
    let q = supabaseAdmin()
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId);
    q = whatsappConfigId
      ? q.eq('whatsapp_config_id', whatsappConfigId)
      : q.is('whatsapp_config_id', null);
    return q.order('created_at', { ascending: true }).limit(1);
  };

  const { data: rows, error } = await findExisting();

  if (error) {
    console.error('[inbound-core] error finding conversation:', error);
    return null;
  }
  if (rows && rows.length > 0) {
    return { conversation: rows[0] as ConversationRow, created: false };
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      whatsapp_config_id: whatsappConfigId,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await findExisting();
      if (raced && raced.length > 0) {
        return { conversation: raced[0] as ConversationRow, created: false };
      }
      // Legacy UNIQUE(account_id, contact_id) from migration 036 may
      // still be live if 039/047/048 were not applied. Only reuse a
      // null-channel row (and stamp it). A thread already bound to
      // another number must not absorb this inbound.
      const { data: anyRows } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      const legacy = anyRows?.[0] as ConversationRow | undefined;
      if (legacy) {
        const plan = planLegacyConversationReuse(
          (legacy.whatsapp_config_id as string | null | undefined) ?? null,
          whatsappConfigId,
        );
        if (plan.action === 'reject') {
          console.error(
            '[inbound-core] refused to merge inbound onto another number\'s thread — apply migration 048',
            {
              conversationId: legacy.id,
              existingConfigId: legacy.whatsapp_config_id,
              incomingConfigId: whatsappConfigId,
            },
          );
          return null;
        }
        if (plan.stamp && whatsappConfigId) {
          await supabaseAdmin()
            .from('conversations')
            .update({ whatsapp_config_id: whatsappConfigId })
            .eq('id', legacy.id);
          legacy.whatsapp_config_id = whatsappConfigId;
        }
        console.warn(
          '[inbound-core] per-contact unique still active — apply migration 048. Reusing',
          legacy.id,
        );
        return { conversation: legacy, created: false };
      }
    }
    console.error('[inbound-core] error creating conversation:', createError);
    return null;
  }

  return { conversation: newConv as ConversationRow, created: true };
}

/** Advance a recent broadcast recipient to "replied" when they write back. */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !recs || recs.length === 0) return;
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id);
  } catch (err) {
    console.error('[inbound-core] flagBroadcastReplyIfAny failed:', err);
  }
}

export interface RecordInboundArgs {
  accountId: string;
  /** WhatsApp config owner — audit user_id on created rows. */
  configOwnerUserId: string;
  /** Sender phone in any format; normalised internally. */
  senderPhone: string;
  /** Extra identity keys (LID, @username, PN) so PN outbound and LID inbound match. */
  identityAliases?: string[];
  whatsappLid?: string | null;
  whatsappUsername?: string | null;
  /** Display name from the provider (pushName), if any. */
  contactName: string;
  /** Plain text body / caption. Null for media with no caption. */
  contentText: string | null;
  /** Public media URL, when the message carried an attachment. */
  mediaUrl: string | null;
  /** One of the allowed content types; anything else falls back to text. */
  contentType: string;
  /** Provider message id (for dedup + reply context). */
  messageId: string;
  /** Message time in ms since epoch. */
  timestampMs: number;
  /**
   * The channel (whatsapp_config row) this message arrived on. New
   * conversations are stamped with it so replies go back out the same
   * number and dedup is per-channel (migration 039). Null = legacy
   * single-channel behaviour.
   */
  whatsappConfigId?: string | null;
  /**
   * True when the message was sent FROM the linked number (a
   * `fromMe` event — typed on the agent's phone / WhatsApp Web, or an
   * echo of a platform send). Recorded as an outgoing agent message so
   * the thread stays in sync, but it never bumps unread, flags a
   * broadcast reply, or triggers flows / automations / the AI bot.
   */
  outbound?: boolean;
  /**
   * Button / list tap. When set, the Flow runner sees an
   * `interactive_reply` (so Evolution menus advance the same way
   * Meta ones do) and automations can match `interactive_reply`.
   * Also persisted on `messages.interactive_reply_id`.
   */
  interactiveReply?: { reply_id: string; reply_title: string };
  /**
   * Provider id of the message this one swipe-replies to (Meta
   * `context.id`, Baileys `contextInfo.stanzaId`). Resolved to an
   * internal `messages.id` after the conversation is known. Missing
   * parent → stored as null.
   */
  replyToMetaMessageId?: string | null;
}

/**
 * Resolve a provider-side message id into the matching internal UUID,
 * scoped to one conversation. Returns null when we never stored the
 * parent (e.g. a swipe-reply to a message older than this CRM).
 */
async function lookupInternalIdByProviderId(
  providerId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', providerId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) {
    console.error('[inbound-core] reply parent lookup failed:', error);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

/**
 * The full inbound pipeline. Idempotent-ish: a duplicate provider
 * `messageId` on the same conversation is a no-op (pre-insert check
 * plus the unique `(conversation_id, message_id)` index from
 * migration 046). Dedup is per-thread so the same Meta id on two
 * numbers is not collapsed.
 */
export async function recordInboundMessage(args: RecordInboundArgs): Promise<void> {
  const {
    accountId,
    configOwnerUserId,
    senderPhone: rawPhone,
    contactName,
    contentText,
    mediaUrl,
    messageId,
    timestampMs,
  } = args;

  const outbound = args.outbound === true;
  const whatsappConfigId = args.whatsappConfigId ?? null;
  const senderPhone = canonicalContactKey(rawPhone);
  if (!senderPhone) return;
  const contentType = normalizeInboundContentType(args.contentType);

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName,
    {
      aliases: args.identityAliases ?? [],
      lid: args.whatsappLid,
      username: args.whatsappUsername,
    },
  );
  if (!contactOutcome) return;
  const contactRecord = contactOutcome.contact;

  const convResult = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id,
    whatsappConfigId,
  );
  if (!convResult) return;
  const conversation = convResult.conversation;

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    });
  }

  // Dedup AFTER the conversation is known so we scope by thread
  // (migration 046 / 009 — Meta ids can repeat across numbers).
  if (messageId) {
    const { data: dup } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', messageId)
      .eq('conversation_id', conversation.id)
      .limit(1)
      .maybeSingle();
    if (dup) return;
  }

  let replyToInternalId: string | null = null;
  if (args.replyToMetaMessageId) {
    replyToInternalId = await lookupInternalIdByProviderId(
      args.replyToMetaMessageId,
      conversation.id,
    );
    if (!replyToInternalId) {
      console.warn(
        '[inbound-core] reply context parent not found:',
        args.replyToMetaMessageId,
      );
    }
  }

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: outbound ? 'agent' : 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: messageId || null,
    status: outbound ? 'sent' : 'delivered',
    created_at: new Date(timestampMs).toISOString(),
    reply_to_message_id: replyToInternalId,
    interactive_reply_id: args.interactiveReply?.reply_id ?? null,
  });
  if (msgError) {
    // A concurrent webhook retry lost the unique race
    // (migration 046). Treat as already stored.
    if (isUniqueViolation(msgError)) return;
    console.error('[inbound-core] error inserting message:', msgError);
    return;
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${args.contentType}]`,
      last_message_at: new Date().toISOString(),
      // Outgoing (fromMe) messages never add to the unread badge.
      unread_count: outbound
        ? conversation.unread_count || 0
        : (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  // Everything below is inbound-only: an agent's own message must not
  // flag a broadcast reply, run the bot, or fire automations.
  if (outbound) return;

  await flagBroadcastReplyIfAny(accountId, contactRecord.id);

  const inboundText = contentText ?? '';

  // Flow runner first — it may consume the message and suppress the
  // content-level automation triggers below.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: args.interactiveReply
      ? {
          kind: 'interactive_reply',
          reply_id: args.interactiveReply.reply_id,
          reply_title: args.interactiveReply.reply_title,
          meta_message_id: messageId,
        }
      : { kind: 'text', text: inboundText, meta_message_id: messageId },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    if (args.interactiveReply?.reply_id) {
      automationTriggers.push('interactive_reply');
    }
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message');

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: args.interactiveReply?.reply_id,
      },
    }).catch((err) => console.error('[inbound-core] automation dispatch failed:', err));
  }

  // AI auto-reply for plain text a flow didn't consume. Button/list
  // taps are not free-text — the menu already chose the next step.
  if (!flowConsumed && !args.interactiveReply && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    });
  }

  // AI lead qualification — runs independently of auto-reply, so wacrm can
  // read the chat, update the contact, and open a deal even when replies
  // are handled elsewhere (a human, or Meta's in-app AI). Inbound only.
  if (!outbound && inboundText.trim()) {
    await dispatchInboundToQualify({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    });
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: messageId,
    content_type: contentType,
    text: contentText,
  });

  // Home-screen PWA + in-app bell. Fire-and-forget so a push-service
  // timeout cannot stall the webhook ack.
  const assignedAgentId =
    typeof conversation.assigned_agent_id === 'string'
      ? conversation.assigned_agent_id
      : null;
  notifyNewInboundMessage({
    accountId,
    conversationId: conversation.id,
    contactId: contactRecord.id,
    contactName: contactRecord.name || contactRecord.phone || 'WhatsApp',
    contentText,
    contentType,
    assignedAgentId,
  }).catch((err) =>
    console.error('[inbound-core] new-message notify failed:', err),
  );
}
