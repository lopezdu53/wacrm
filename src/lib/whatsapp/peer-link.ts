import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExistingContact } from '@/lib/contacts/dedupe';
import { isWhatsAppHandleKey } from '@/lib/whatsapp/phone-utils';
import type { EvolutionPeer } from '@/lib/whatsapp/peer-identity';
import { contactKeyToRemoteJid } from '@/lib/whatsapp/peer-identity';
import type { EvolutionHistoryItem } from '@/lib/whatsapp/evolution-api';

/**
 * True when this inbound peer is still handle-only (LID / @username)
 * and we have not already linked it to an E.164 contact. Those chats
 * need a second look — Evolution often omits remoteJidAlt, so the
 * agent's sends land on the phone conversation while customer replies
 * land on the LID conversation.
 */
export function needsHistoryLink(
  peer: EvolutionPeer,
  existing: ExistingContact[],
): boolean {
  if (peer.phone) return false;
  if (existing.some((c) => c.phone && !isWhatsAppHandleKey(c.phone))) {
    return false;
  }
  if (existing.length > 1) return false;
  return Boolean(peer.lid || peer.username);
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

/**
 * Contacts on this WhatsApp number that already stored these provider
 * message ids. Same WhatsApp id = same chat, even when one event used
 * the LID and another used the phone.
 */
export async function findContactKeysByMessageIds(
  db: SupabaseClient,
  accountId: string,
  whatsappConfigId: string | null,
  messageIds: string[],
): Promise<string[]> {
  const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    50,
  );
  if (ids.length === 0) return [];

  const { data: rows, error } = await db
    .from('messages')
    .select('conversation_id')
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
  const contactIds = [
    ...new Set(
      (convos ?? [])
        .filter((c) => (c.whatsapp_config_id ?? null) === (whatsappConfigId ?? null))
        .map((c) => c.contact_id as string)
        .filter(Boolean),
    ),
  ];
  if (contactIds.length === 0) return [];

  const { data: contacts } = await db
    .from('contacts')
    .select('phone, whatsapp_lid, whatsapp_username')
    .eq('account_id', accountId)
    .in('id', contactIds);

  const keys: string[] = [];
  for (const c of contacts ?? []) {
    if (c.phone) keys.push(c.phone as string);
    if (c.whatsapp_lid) keys.push(`lid:${c.whatsapp_lid}`);
    if (c.whatsapp_username) keys.push(`user:${c.whatsapp_username}`);
  }
  return keys;
}
