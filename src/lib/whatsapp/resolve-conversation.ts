// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The dashboard composer always has a `conversation_id` in hand. The
// public API doesn't — an external automation knows a *phone number*,
// not an internal UUID. This helper bridges that: given an E.164
// phone, it finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// It deliberately reuses the exact find-or-create logic the inbound
// webhook uses (the `findExistingContact` dedupe helper, the
// one-conversation-per-(account, contact) convention, the
// account_id-tenancy / user_id-audit split) so a contact created via
// the API is indistinguishable from one created by an inbound message.
//
// Audit user: created rows need a NOT NULL `user_id`. As with the
// webhook (where there's no logged-in human either), we attribute
// them to the WhatsApp config owner — a stable account-level default.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

export interface ResolveConversationOptions {
  /**
   * Channel to stamp / look up. When omitted we pick the account's
   * oldest Meta config (then any config) so API-created threads land
   * on a real number instead of a null-channel row that later replies
   * can send out the wrong provider.
   */
  whatsappConfigId?: string | null;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
function firstRow<T extends { id?: string }>(
  data: T | T[] | null | undefined
): T | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

/**
 * Pick the WhatsApp config an outbound-created conversation should
 * belong to: an explicit id, else the oldest Meta number, else any.
 */
async function resolveDefaultConfigId(
  db: SupabaseClient,
  accountId: string,
  preferredId?: string | null
): Promise<{ id: string } | null> {
  if (preferredId) {
    const { data } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', preferredId)
      .maybeSingle();
    if (data?.id) return { id: data.id as string };
  }

  const { data: meta } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (meta?.id) return { id: meta.id as string };

  const { data } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ? { id: data.id as string } : null;
}

export async function resolveConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name?: string | null,
  options: ResolveConversationOptions = {}
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway. Prefer an
  // explicit channel, then Meta, then any — `.maybeSingle()` without
  // a limit throws (PGRST116) once the account has two numbers.
  const config = await resolveDefaultConfigId(
    db,
    accountId,
    options.whatsappConfigId
  );
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // Audit user for created rows = the single account-wide default used
  // by every public-API write (see resolveAuditUserId), so a contact
  // created here is attributed identically to one created via
  // POST /api/v1/contacts. resolveAuditUserId throws ContactError only
  // if the owner can't be resolved — remap it to the send error family
  // the callers already handle.
  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated = false;

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: sanitized,
        name: name || sanitized,
      })
      .select('id')
      .single();

    if (createErr || !created) {
      // Lost a race against a concurrent inbound/API create — the
      // unique index (migration 022) rejected the duplicate. Re-resolve.
      if (isUniqueViolation(createErr)) {
        const raced = await findExistingContact(db, accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError(
            'db_error',
            'Failed to create contact',
            500
          );
        }
      } else {
        console.error(
          '[resolve-conversation] contact create error:',
          createErr
        );
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    } else {
      contactId = created.id;
      contactCreated = true;
    }
  }

  // ---- conversation -------------------------------------------
  // One conversation per (account, contact) — same convention as the
  // webhook. Order oldest-first and take one row rather than
  // `.maybeSingle()`, which errors on ≥2 rows: if duplicates predate the
  // unique index (migration 036), we resolve to the canonical survivor
  // instead of falling through and creating yet another (issue #363).
  const conversationId = await findOrCreateConversationForContact(
    db,
    accountId,
    contactId,
    ownerUserId,
    config.id
  );

  return { conversationId, contactId, contactCreated };
}

/**
 * Find (oldest-first) or create the conversation for
 * `(accountId, contactId[, channel])`. When `whatsappConfigId` is
 * set the lookup is scoped to that channel (migration 039); a
 * null-channel legacy thread for the same contact is reused so we
 * don't fragment the inbox. Unique-index races re-resolve the
 * winning row instead of failing the send (issue #363).
 */
export async function findOrCreateConversationForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  ownerUserId: string,
  whatsappConfigId?: string | null
): Promise<string> {
  const lookup = async (channelId: string | null | undefined) => {
    let q = db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId);
    q = channelId
      ? q.eq('whatsapp_config_id', channelId)
      : q.is('whatsapp_config_id', null);
    return q.order('created_at', { ascending: true }).limit(1);
  };

  // Prefer the stamped channel; if none exists, reuse a legacy
  // null-channel thread for this contact so an API send doesn't
  // open a second chat next to the inbound one.
  const { data: onChannel, error: findErr } = await lookup(
    whatsappConfigId ?? null
  );
  if (findErr) {
    console.error('[resolve-conversation] conversation lookup error:', findErr);
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500);
  }
  const channelHit = firstRow(onChannel);
  if (channelHit?.id) return channelHit.id;

  if (whatsappConfigId) {
    const { data: legacy } = await lookup(null);
    const legacyHit = firstRow(legacy);
    if (legacyHit?.id) return legacyHit.id;

    // Last resort: any existing thread for this contact (pre-039
    // duplicates, or a thread on another number the agent is
    // already working). Reusing beats fragmenting.
    const { data: anyRows } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    const anyHit = firstRow(anyRows);
    if (anyHit?.id) return anyHit.id;
  }

  const { data: newConv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      whatsapp_config_id: whatsappConfigId ?? null,
    })
    .select('id')
    .single();

  if (convErr || !newConv) {
    if (isUniqueViolation(convErr)) {
      const { data: raced } = await lookup(whatsappConfigId ?? null);
      const racedHit = firstRow(raced);
      if (racedHit?.id) return racedHit.id;
      const { data: anyRaced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      const anyRacedHit = firstRow(anyRaced);
      if (anyRacedHit?.id) return anyRacedHit.id;
    }
    console.error('[resolve-conversation] conversation create error:', convErr);
    throw new SendMessageError('db_error', 'Failed to create conversation', 500);
  }

  return newConv.id;
}
