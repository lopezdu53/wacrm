/**
 * Undo the N-way LID/phone merge that dumped every @username chat into
 * one inbox thread. Evolution still knows which provider `message_id`
 * belongs to which remoteJid — we move CRM messages back to that peer
 * and only keep a 1:1 handle↔phone link when THIS Evolution item lists
 * both identities.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExistingContact } from '@/lib/contacts/dedupe';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import {
  isProvenPeerPair,
  mergePeerContacts,
  pickSurvivorContact,
} from '@/lib/contacts/merge-peer';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  fetchEvolutionChats,
  fetchEvolutionMessages,
  type EvolutionChatItem,
  type EvolutionHistoryItem,
} from '@/lib/whatsapp/evolution-api';
import type { EvoInboundConfig } from '@/lib/whatsapp/evolution-inbound';
import {
  contactKeyToRemoteJid,
  peerLookupKeys,
  resolveEvolutionPeer,
  type EvolutionPeer,
  type EvolutionPeerSource,
} from '@/lib/whatsapp/peer-identity';
import { exclusiveLinkedKeys } from '@/lib/whatsapp/peer-link';
import {
  canonicalContactKey,
  formatWhatsAppAddress,
} from '@/lib/whatsapp/phone-utils';
import { findOrCreateConversation } from '@/lib/whatsapp/inbound-core';

export interface MessagePeerAssignment {
  messageId: string;
  peer: EvolutionPeer;
  pushName: string;
}

export function chatRowToPeerSource(chat: EvolutionChatItem): EvolutionPeerSource {
  const remoteJid = chat.remoteJid || chat.id;
  return {
    key: {
      remoteJid,
      remoteJidAlt: chat.remoteJidAlt,
      senderLid: chat.senderLid || (chat.lid ? `${chat.lid}@lid` : undefined),
      senderPn: chat.senderPn,
    },
    pushName: chat.pushName || chat.name || chat.notify,
    remoteJidAlt: chat.remoteJidAlt,
    senderLid: chat.senderLid,
    senderPn: chat.senderPn,
    lid: chat.lid,
  };
}

export function isOneToOneChatJid(jid: string | undefined | null): boolean {
  if (!jid) return false;
  const host = jid.includes('@') ? jid.slice(jid.indexOf('@')).toLowerCase() : '';
  return host !== '@g.us' && host !== '@broadcast' && host !== '@newsletter';
}

/**
 * If any Evolution item listed both a handle and an E.164, remember that
 * mapping so LID-only history for the same person can follow the phone.
 */
export function handlePhoneLinksFromPeers(
  peers: EvolutionPeer[],
): Map<string, string> {
  const links = new Map<string, string>();
  for (const peer of peers) {
    if (!peer.phone) continue;
    if (peer.lid) links.set(`lid:${peer.lid}`, peer.phone);
    if (peer.username) links.set(`user:${peer.username}`, peer.phone);
  }
  return links;
}

export function enrichPeerWithLinks(
  peer: EvolutionPeer,
  links: Map<string, string>,
): EvolutionPeer {
  if (peer.phone) {
    return peer.contactKey === peer.phone
      ? peer
      : { ...peer, contactKey: peer.phone };
  }
  const fromLid = peer.lid ? links.get(`lid:${peer.lid}`) : undefined;
  const fromUser = peer.username ? links.get(`user:${peer.username}`) : undefined;
  const phone = fromLid || fromUser || null;
  if (!phone) return peer;
  return { ...peer, phone, contactKey: phone };
}

/**
 * True when this CRM contact is the WhatsApp person Evolution named on
 * the message — matching `contacts.phone` against the payload identities,
 * never a leftover `whatsapp_lid` stamp from the giant merge.
 */
export function contactPhoneMatchesPeer(
  contactPhone: string,
  peer: EvolutionPeer,
): boolean {
  const key = canonicalContactKey(contactPhone);
  if (!key) return false;
  if (key === peer.contactKey) return true;
  if (peer.phone && key === canonicalContactKey(peer.phone)) return true;
  if (peer.lid && key === `lid:${peer.lid}`) return true;
  if (peer.username && key === `user:${peer.username}`) return true;
  return false;
}

/**
 * Map provider message ids to the Evolution peer that owns them.
 * Duplicate ids under a handle and an E.164 collapse to one person.
 * The same id on two phones is treated as a collision and skipped.
 */
export function assignMessagesToPeers(
  items: EvolutionHistoryItem[],
): Map<string, MessagePeerAssignment> {
  const byId = new Map<string, { peer: EvolutionPeer; pushName: string }[]>();
  const collectedPeers: EvolutionPeer[] = [];

  for (const item of items) {
    const id = item.key?.id?.trim();
    if (!id) continue;
    const peer = resolveEvolutionPeer(item);
    if (!peer) continue;
    collectedPeers.push(peer);
    const list = byId.get(id) ?? [];
    list.push({
      peer,
      // fromMe pushName is the linked WhatsApp account, not the customer.
      pushName: item.key?.fromMe ? '' : (item.pushName ?? ''),
    });
    byId.set(id, list);
  }

  const links = handlePhoneLinksFromPeers(collectedPeers);
  const out = new Map<string, MessagePeerAssignment>();

  for (const [messageId, rows] of byId) {
    const unique = new Map<string, { peer: EvolutionPeer; pushName: string }>();
    for (const row of rows) {
      const peer = enrichPeerWithLinks(row.peer, links);
      unique.set(peer.contactKey, { peer, pushName: row.pushName });
    }
    const distinct = [...unique.values()];
    if (distinct.length === 1) {
      out.set(messageId, {
        messageId,
        peer: distinct[0].peer,
        pushName: distinct[0].pushName,
      });
      continue;
    }
    if (distinct.length === 2) {
      const [a, b] = distinct;
      const fakeA = { id: 'a', phone: a.peer.contactKey };
      const fakeB = { id: 'b', phone: b.peer.contactKey };
      if (
        isProvenPeerPair(fakeA, fakeB, {
          aliases: [...peerLookupKeys(a.peer), ...peerLookupKeys(b.peer)],
          lid: a.peer.lid || b.peer.lid,
          username: a.peer.username || b.peer.username,
        })
      ) {
        const mergedPhone = a.peer.phone || b.peer.phone;
        const mergedUser = a.peer.username || b.peer.username;
        const mergedLid = a.peer.lid || b.peer.lid;
        const merged: EvolutionPeer = {
          contactKey: mergedPhone
            ? mergedPhone
            : mergedUser
              ? `user:${mergedUser}`
              : mergedLid
                ? `lid:${mergedLid}`
                : a.peer.contactKey,
          phone: mergedPhone,
          lid: mergedLid,
          username: mergedUser,
        };
        out.set(messageId, {
          messageId,
          peer: enrichPeerWithLinks(merged, links),
          pushName: a.pushName || b.pushName,
        });
      }
    }
  }
  return out;
}

const lastRepairAt = new Map<string, number>();
const REPAIR_TTL_MS = 10 * 60 * 1000;

export function resetRepairCacheForTests(): void {
  lastRepairAt.clear();
}

export interface RepairMixedResult {
  lookedUp: number;
  moved: number;
  conversationsTouched: number;
}

export async function repairMixedEvolutionConversationsOnce(
  config: EvoInboundConfig,
): Promise<RepairMixedResult | null> {
  if (
    !config.evolution_base_url ||
    !config.evolution_api_key ||
    !config.evolution_instance
  ) {
    return null;
  }
  const cacheKey = `${config.account_id}:${config.id}`;
  const last = lastRepairAt.get(cacheKey) ?? 0;
  if (Date.now() - last < REPAIR_TTL_MS) return null;
  lastRepairAt.set(cacheKey, Date.now());
  try {
    const result = await repairMixedEvolutionConversations(config);
    if (result.lookedUp === 0) lastRepairAt.delete(cacheKey);
    else {
      console.info('[repair-mixed] split collapsed Evolution chats', {
        accountId: config.account_id,
        configId: config.id,
        ...result,
      });
    }
    return result;
  } catch (err) {
    lastRepairAt.delete(cacheKey);
    console.error('[repair-mixed] failed:', err);
    return null;
  }
}

export async function repairMixedEvolutionConversations(
  config: EvoInboundConfig,
): Promise<RepairMixedResult> {
  const empty: RepairMixedResult = {
    lookedUp: 0,
    moved: 0,
    conversationsTouched: 0,
  };
  if (
    !config.evolution_base_url ||
    !config.evolution_api_key ||
    !config.evolution_instance
  ) {
    return empty;
  }

  const auth = {
    baseUrl: config.evolution_base_url,
    apiKey: config.evolution_api_key,
    instance: config.evolution_instance,
  };

  const chats = (await fetchEvolutionChats({ ...auth, timeoutMs: 6000 })).filter(
    (chat) => isOneToOneChatJid(chat.remoteJid || chat.id),
  );

  const items: EvolutionHistoryItem[] = [];
  const chatPeers: EvolutionPeer[] = [];
  for (const chat of chats.slice(0, 40)) {
    const source = chatRowToPeerSource(chat);
    const peer = resolveEvolutionPeer(source);
    const remoteJid = chat.remoteJid || chat.id;
    if (!remoteJid) continue;
    const batch = await fetchEvolutionMessages({
      ...auth,
      remoteJid,
      limit: 80,
      timeoutMs: 4000,
    });
    const attached = batch.map((item) => attachChatAliases(item, source));
    items.push(...attached);
    if (peer) {
      const extras = exclusiveLinkedKeys(peer, attached);
      const linked: EvolutionPeer = { ...peer };
      for (const key of extras) {
        if (key.startsWith('lid:') && !linked.lid) linked.lid = key.slice(4);
        else if (key.startsWith('user:') && !linked.username) {
          linked.username = key.slice(5);
        } else if (!key.startsWith('lid:') && !key.startsWith('user:') && !linked.phone) {
          linked.phone = key;
        }
      }
      chatPeers.push(linked);
    }
  }

  if (items.length === 0) {
    const unscoped = await fetchEvolutionMessages({
      ...auth,
      limit: 200,
      timeoutMs: 6000,
    });
    items.push(...unscoped);
  }

  const assignments = assignMessagesToPeers(items);
  const links = handlePhoneLinksFromPeers([
    ...chatPeers,
    ...[...assignments.values()].map((row) => row.peer),
  ]);
  for (const row of assignments.values()) {
    row.peer = enrichPeerWithLinks(row.peer, links);
  }

  if (assignments.size === 0) return { ...empty, lookedUp: items.length };

  const db = supabaseAdmin();
  const moved = await redistributeAssignedMessages(db, config, assignments);
  return {
    lookedUp: items.length,
    moved: moved.moved,
    conversationsTouched: moved.conversationsTouched,
  };
}

function attachChatAliases(
  item: EvolutionHistoryItem,
  chat: EvolutionPeerSource,
): EvolutionHistoryItem {
  const key = { ...(item.key ?? {}) };
  if (!key.remoteJid) key.remoteJid = chat.key?.remoteJid;
  if (!key.remoteJidAlt) {
    key.remoteJidAlt = chat.key?.remoteJidAlt ?? chat.remoteJidAlt;
  }
  if (!key.senderLid) key.senderLid = chat.key?.senderLid ?? chat.senderLid;
  if (!key.senderPn) key.senderPn = chat.key?.senderPn ?? chat.senderPn;
  if (!key.remoteJidUsername && chat.key?.remoteJidUsername) {
    key.remoteJidUsername = chat.key.remoteJidUsername;
  }
  return {
    ...item,
    key,
    pushName: item.pushName || chat.pushName,
    remoteJidAlt: item.remoteJidAlt || chat.remoteJidAlt,
    senderLid: item.senderLid || chat.senderLid,
    senderPn: item.senderPn || chat.senderPn,
  };
}

interface StoredMessage {
  id: string;
  conversation_id: string;
  message_id: string | null;
  content_text: string | null;
  content_type: string | null;
  created_at: string | null;
}

interface StoredConvo {
  id: string;
  contact_id: string;
  unread_count: number | null;
  last_message_text: string | null;
  last_message_at: string | null;
}

async function redistributeAssignedMessages(
  db: SupabaseClient,
  config: EvoInboundConfig,
  assignments: Map<string, MessagePeerAssignment>,
): Promise<{ moved: number; conversationsTouched: number }> {
  const { data: convos } = await db
    .from('conversations')
    .select('id, contact_id, unread_count, last_message_text, last_message_at')
    .eq('account_id', config.account_id)
    .eq('whatsapp_config_id', config.id);

  const conversationRows = (convos ?? []) as StoredConvo[];
  if (conversationRows.length === 0) {
    return { moved: 0, conversationsTouched: 0 };
  }

  const contactIds = [
    ...new Set(conversationRows.map((row) => row.contact_id).filter(Boolean)),
  ];
  const { data: contactRows } = await db
    .from('contacts')
    .select('id, phone, name, whatsapp_lid, whatsapp_username')
    .eq('account_id', config.account_id)
    .in('id', contactIds);

  const contactById = new Map<string, ExistingContact>();
  for (const row of (contactRows ?? []) as ExistingContact[]) {
    contactById.set(row.id, row);
  }

  const convoById = new Map(conversationRows.map((row) => [row.id, row]));
  const messages = await loadMessagesForConversations(
    db,
    conversationRows.map((row) => row.id),
  );

  const touched = new Set<string>();
  let moved = 0;

  for (const msg of messages) {
    const providerId = (msg.message_id ?? '').trim();
    if (!providerId) continue;
    const assignment = assignments.get(providerId);
    if (!assignment) continue;

    const convo = convoById.get(msg.conversation_id);
    if (!convo) continue;
    const current = contactById.get(convo.contact_id);
    if (current && contactPhoneMatchesPeer(current.phone, assignment.peer)) {
      continue;
    }

    const target = await ensureRepairContact(
      db,
      config,
      assignment.peer,
      assignment.pushName || current?.name || '',
    );
    if (!target) continue;
    contactById.set(target.id, target);

    const dest = await findOrCreateConversation(
      config.account_id,
      config.user_id,
      target.id,
      config.id,
    );
    if (!dest) continue;
    const destId = dest.conversation.id as string;
    if (destId === msg.conversation_id) continue;

    const { error } = await db
      .from('messages')
      .update({ conversation_id: destId })
      .eq('id', msg.id);
    if (error && isUniqueViolation(error)) {
      await db.from('messages').delete().eq('id', msg.id);
    } else if (error) {
      console.error('[repair-mixed] failed to move message', error);
      continue;
    }
    moved += 1;
    touched.add(msg.conversation_id);
    touched.add(destId);
  }

  for (const conversationId of touched) {
    await refreshConversationPreview(db, conversationId);
  }

  return { moved, conversationsTouched: touched.size };
}

async function loadMessagesForConversations(
  db: SupabaseClient,
  conversationIds: string[],
): Promise<StoredMessage[]> {
  const out: StoredMessage[] = [];
  for (let i = 0; i < conversationIds.length; i += 50) {
    const chunk = conversationIds.slice(i, i + 50);
    const { data } = await db
      .from('messages')
      .select('id, conversation_id, message_id, content_text, content_type, created_at')
      .in('conversation_id', chunk);
    out.push(...((data ?? []) as StoredMessage[]));
  }
  return out;
}

async function ensureRepairContact(
  db: SupabaseClient,
  config: EvoInboundConfig,
  peer: EvolutionPeer,
  pushName: string,
): Promise<ExistingContact | null> {
  const keys = [
    ...new Set(
      [
        peer.phone,
        peer.contactKey,
        peer.lid ? `lid:${peer.lid}` : '',
        peer.username ? `user:${peer.username}` : '',
      ]
        .map((value) => canonicalContactKey(value))
        .filter(Boolean),
    ),
  ];

  const found: ExistingContact[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const { data } = await db
      .from('contacts')
      .select('*')
      .eq('account_id', config.account_id)
      .eq('phone', key)
      .maybeSingle();
    if (data && !seen.has((data as ExistingContact).id)) {
      seen.add((data as ExistingContact).id);
      found.push(data as ExistingContact);
    }
  }

  let contact: ExistingContact | null = null;
  if (found.length === 1) {
    contact = found[0];
  } else if (found.length === 2 && isProvenPeerPair(found[0], found[1], {
    aliases: keys,
    lid: peer.lid,
    username: peer.username,
  })) {
    const survivor = pickSurvivorContact(
      found,
      peer.phone || peer.contactKey,
    );
    contact = await mergePeerContacts(
      db,
      survivor,
      found.filter((row) => row.id !== survivor.id),
    );
  } else if (found.length > 0) {
    contact =
      found.find((row) => canonicalContactKey(row.phone) === peer.contactKey) ??
      found.find((row) => peer.phone && canonicalContactKey(row.phone) === peer.phone) ??
      found[0];
  }

  if (!contact) {
    if (peer.lid) {
      await db
        .from('contacts')
        .update({ whatsapp_lid: null })
        .eq('account_id', config.account_id)
        .eq('whatsapp_lid', peer.lid);
    }
    if (peer.username) {
      await db
        .from('contacts')
        .update({ whatsapp_username: null })
        .eq('account_id', config.account_id)
        .eq('whatsapp_username', peer.username);
    }
    const phone = peer.phone || peer.contactKey;
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: config.account_id,
        user_id: config.user_id,
        phone,
        name: pushName || formatWhatsAppAddress(phone) || phone,
        whatsapp_lid: peer.lid,
        whatsapp_username: peer.username,
      })
      .select()
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        const { data: raced } = await db
          .from('contacts')
          .select('*')
          .eq('account_id', config.account_id)
          .eq('phone', phone)
          .maybeSingle();
        return (raced as ExistingContact | null) ?? null;
      }
      console.error('[repair-mixed] failed to create contact', error);
      return null;
    }
    return created as ExistingContact;
  }

  const patch: Record<string, unknown> = {};
  if (peer.lid && contact.whatsapp_lid !== peer.lid) {
    await db
      .from('contacts')
      .update({ whatsapp_lid: null })
      .eq('account_id', config.account_id)
      .eq('whatsapp_lid', peer.lid)
      .neq('id', contact.id);
    patch.whatsapp_lid = peer.lid;
  }
  if (peer.username && contact.whatsapp_username !== peer.username) {
    await db
      .from('contacts')
      .update({ whatsapp_username: null })
      .eq('account_id', config.account_id)
      .eq('whatsapp_username', peer.username)
      .neq('id', contact.id);
    patch.whatsapp_username = peer.username;
  }
  if (
    pushName &&
    (!contact.name || contact.name === contact.phone) &&
    pushName !== contact.name
  ) {
    patch.name = pushName;
  }
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    await db.from('contacts').update(patch).eq('id', contact.id);
    return { ...contact, ...patch } as ExistingContact;
  }
  return contact;
}

async function refreshConversationPreview(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { data: latest } = await db
    .from('messages')
    .select('content_text, content_type, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!latest || latest.length === 0) {
    await db.from('conversations').delete().eq('id', conversationId);
    return;
  }
  const row = latest[0] as {
    content_text: string | null;
    content_type: string | null;
    created_at: string | null;
  };
  await db
    .from('conversations')
    .update({
      last_message_text: row.content_text || `[${row.content_type ?? 'text'}]`,
      last_message_at: row.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}

/** remoteJids used when listing chats failed and we only have CRM contacts. */
export function fallbackRemoteJids(phones: string[]): string[] {
  const out: string[] = [];
  for (const phone of phones) {
    const jid = contactKeyToRemoteJid(phone);
    if (jid && !out.includes(jid)) out.push(jid);
  }
  return out;
}
