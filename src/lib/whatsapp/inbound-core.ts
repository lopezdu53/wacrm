/**
 * Provider-agnostic inbound-message core.
 *
 * The Meta webhook (`/api/whatsapp/webhook`) has always owned this logic
 * inline. The Evolution webhook (`/api/whatsapp/evolution/webhook`) needs
 * the exact same behaviour — find-or-create the contact + conversation,
 * persist the message, then fan out to the Flow runner, automations, the
 * AI auto-reply, and the public webhook dispatcher.
 *
 * Rather than refactor the battle-tested Meta path (and risk a regression
 * on the critical inbound route), this module re-implements the shared
 * core once, transport-neutral: callers hand in already-normalised fields
 * (a plain E.164-ish phone, the text, an optional media URL) instead of a
 * Meta- or Baileys-shaped payload. The Meta webhook keeps its own copy;
 * the Evolution webhook uses this.
 */

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

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

interface ContactRow {
  id: string;
  name: string;
  phone: string;
  [key: string]: unknown;
}

interface ContactOutcome {
  contact: ContactRow;
  wasCreated: boolean;
}

/** Find an account's contact by phone (shared dedupe), or create it. */
export async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone);

  if (existing) {
    if (name && name !== existing.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return { contact: existing as ContactRow, wasCreated: false };
  }

  const { data: newContact, error } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (error) {
    // Lost a race — re-resolve the row the unique index kept.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone);
      if (raced) return { contact: raced as ContactRow, wasCreated: false };
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

/** Find the account's oldest conversation for a contact, or create one. */
export async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
): Promise<{ conversation: ConversationRow; created: boolean } | null> {
  const { data: rows, error } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[inbound-core] error finding conversation:', error);
    return null;
  }
  if (rows && rows.length > 0) {
    return { conversation: rows[0] as ConversationRow, created: false };
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: configOwnerUserId, contact_id: contactId })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0] as ConversationRow, created: false };
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
}

/**
 * The full inbound pipeline. Idempotent-ish: a duplicate provider
 * `messageId` is caught by the Flow runner's dedup and by a pre-insert
 * check here so a webhook retry doesn't double-store the message.
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

  const senderPhone = normalizePhone(rawPhone);
  const contentType = ALLOWED_CONTENT_TYPES.has(args.contentType)
    ? args.contentType
    : 'text';

  // Dedup: a webhook replay for a message we already stored is a no-op.
  if (messageId) {
    const { data: dup } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', messageId)
      .limit(1)
      .maybeSingle();
    if (dup) return;
  }

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName,
  );
  if (!contactOutcome) return;
  const contactRecord = contactOutcome.contact;

  const convResult = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id,
  );
  if (!convResult) return;
  const conversation = convResult.conversation;

  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    });
  }

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: messageId || null,
    status: 'delivered',
    created_at: new Date(timestampMs).toISOString(),
  });
  if (msgError) {
    console.error('[inbound-core] error inserting message:', msgError);
    return;
  }

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  await flagBroadcastReplyIfAny(accountId, contactRecord.id);

  const inboundText = contentText ?? '';

  // Flow runner first — it may consume the message and suppress the
  // content-level automation triggers below.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: inboundText, meta_message_id: messageId },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = [];
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
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
      },
    }).catch((err) => console.error('[inbound-core] automation dispatch failed:', err));
  }

  // AI auto-reply for plain text a flow didn't consume.
  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
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
}
