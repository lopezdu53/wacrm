import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExistingContact } from '@/lib/contacts/dedupe';
import { isWhatsAppHandleKey } from '@/lib/whatsapp/phone-utils';
import type { EvolutionPeer } from '@/lib/whatsapp/peer-identity';
import {
  contactKeyToRemoteJid,
  resolveEvolutionPeer,
} from '@/lib/whatsapp/peer-identity';
import type { EvolutionHistoryItem } from '@/lib/whatsapp/evolution-api';

/**
 * True when this inbound peer is still missing the other half of the
 * WhatsApp identity (LID without phone, or phone without LID) and we
 * have not already linked it. Evolution often omits remoteJidAlt, so
 * we look at THIS chat's own history — never other people's threads.
 */
export function needsHistoryLink(
  peer: EvolutionPeer,
  existing: ExistingContact[],
): boolean {
  if (peer.lid || peer.username) {
    if (peer.phone) return false;
    if (existing.some((c) => c.phone && !isWhatsAppHandleKey(c.phone))) {
      return false;
    }
    return existing.length <= 1;
  }
  if (peer.phone && !peer.lid && !peer.username) {
    if (
      existing.some(
        (c) =>
          Boolean(c.whatsapp_lid) || Boolean(c.whatsapp_username),
      )
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export function historyMessageIds(items: EvolutionHistoryItem[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = item.key?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function remoteJidsForHistory(peer: EvolutionPeer): string[] {
  const jids: string[] = [];
  const add = (value: string | null | undefined) => {
    if (value && !jids.includes(value)) jids.push(value);
  };
  add(contactKeyToRemoteJid(peer.contactKey));
  if (peer.lid) add(`${peer.lid}@lid`);
  if (peer.username) add(`${peer.username}@s.whatsapp.net`);
  if (peer.phone) add(`${peer.phone}@s.whatsapp.net`);
  return jids;
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Identities listed on Evolution history for ONE requested chat.
 *
 * A scoped LID chat may come back rewritten as a single E.164 — that
 * is the mapping we want. Unscoped findMessages (many phones and many
 * LIDs) returns nothing so we never mix Mao with Sebastian again.
 */
export function exclusiveLinkedKeys(
  peer: EvolutionPeer,
  items: EvolutionHistoryItem[],
): string[] {
  const resolved: EvolutionPeer[] = [];
  for (const item of items) {
    const parsed = resolveEvolutionPeer(item);
    if (parsed) resolved.push(parsed);
  }
  if (resolved.length === 0) return [];

  const phones = unique(resolved.map((p) => p.phone));
  const lids = unique(resolved.map((p) => p.lid));
  const users = unique(resolved.map((p) => p.username));

  if (phones.length > 1 && lids.length > 1) return [];
  if (phones.length > 1 && users.length > 1) return [];
  if (phones.length > 2) return [];
  if (lids.length > 2) return [];

  const keys: string[] = [];
  if (!peer.phone && phones.length === 1) keys.push(phones[0]);
  if (!peer.lid && lids.length === 1) keys.push(`lid:${lids[0]}`);
  if (!peer.username && users.length === 1) keys.push(`user:${users[0]}`);
  return keys;
}

/**
 * Same WhatsApp message ids already stored on this number, but only
 * when they all belong to exactly one other contact. Two or more
 * E.164 hits means the history was unscoped — do not link.
 */
export async function findExclusiveAliasByMessageIds(
  db: SupabaseClient,
  accountId: string,
  whatsappConfigId: string | null,
  peer: EvolutionPeer,
  items: EvolutionHistoryItem[],
): Promise<string[]> {
  const ids = historyMessageIds(items).slice(0, 40);
  if (ids.length < 1) return [];

  const { data: rows, error } = await db
    .from('messages')
    .select('conversation_id, message_id')
    .in('message_id', ids);
  if (error || !rows?.length) return [];

  const convIds = [
    ...new Set(
      rows
        .map((row) => row.conversation_id as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (convIds.length === 0) return [];

  const { data: convos } = await db
    .from('conversations')
    .select('id, contact_id, whatsapp_config_id')
    .eq('account_id', accountId)
    .in('id', convIds);
  const onChannel = (convos ?? []).filter(
    (c) => (c.whatsapp_config_id ?? null) === (whatsappConfigId ?? null),
  );
  const overlap = new Map<string, number>();
  const convContact = new Map(
    onChannel.map((c) => [c.id as string, c.contact_id as string]),
  );
  for (const row of rows) {
    const contactId = convContact.get(row.conversation_id as string);
    if (!contactId) continue;
    overlap.set(contactId, (overlap.get(contactId) ?? 0) + 1);
  }

  const contactIds = [...overlap.keys()];
  if (contactIds.length === 0) return [];

  const { data: contacts } = await db
    .from('contacts')
    .select('id, phone, whatsapp_lid, whatsapp_username')
    .eq('account_id', accountId)
    .in('id', contactIds);

  const e164: ExistingContact[] = [];
  const handles: ExistingContact[] = [];
  for (const row of (contacts ?? []) as ExistingContact[]) {
    if ((overlap.get(row.id) ?? 0) < 1) continue;
    if (isWhatsAppHandleKey(row.phone)) handles.push(row);
    else e164.push(row);
  }

  if (!peer.phone && e164.length === 1 && handles.length <= 1) {
    const target = e164[0];
    if (
      peer.lid &&
      target.whatsapp_lid &&
      String(target.whatsapp_lid) !== peer.lid
    ) {
      return [];
    }
    if (
      peer.username &&
      target.whatsapp_username &&
      String(target.whatsapp_username) !== peer.username
    ) {
      return [];
    }
    return [target.phone];
  }

  if (peer.phone && !peer.lid && !peer.username && handles.length === 1) {
    return [handles[0].phone];
  }

  return [];
}
