import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExistingContact } from '@/lib/contacts/dedupe';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import {
  canonicalContactKey,
  canonicalizeWhatsAppUsername,
  isWhatsAppHandleKey,
} from '@/lib/whatsapp/phone-utils';

export interface PeerMergeOptions {
  aliases?: string[];
  lid?: string | null;
  username?: string | null;
}

/**
 * True when this contact is this WhatsApp person on the current payload.
 *
 * Match the stored `phone` key, or an exact `whatsapp_lid` /
 * `whatsapp_username` stamp. After a LID+phone merge the survivor is
 * E.164 with the LID stamped; a later LID-only inbound must still land
 * on that row. A leftover stamp on the wrong person is a data issue
 * (unique `whatsapp_lid`) — rejecting the stamp created a second chat.
 */
export function isContactOnPayload(
  contact: ExistingContact,
  payloadKeys: Iterable<string>,
): boolean {
  const key = canonicalContactKey(contact.phone);
  const aliases = new Set(
    [...payloadKeys].map((value) => canonicalContactKey(value)).filter(Boolean),
  );
  if (key && aliases.has(key)) return true;

  const lid = String(contact.whatsapp_lid ?? '').replace(/\D/g, '');
  if (lid && aliases.has(`lid:${lid}`)) return true;

  const username = canonicalizeWhatsAppUsername(
    String(contact.whatsapp_username ?? ''),
  );
  if (username && aliases.has(`user:${username}`)) return true;

  return false;
}

function identityKind(key: string): 'user' | 'lid' | 'phone' | '' {
  if (!key) return '';
  if (key.startsWith('user:')) return 'user';
  if (key.startsWith('lid:')) return 'lid';
  if (isWhatsAppHandleKey(key)) return key.startsWith('user:') ? 'user' : 'lid';
  return 'phone';
}

/** True when one key is E.164 and the other is LID or @username. */
export function areComplementaryContactPhones(
  phoneA: string,
  phoneB: string,
): boolean {
  const kindA = identityKind(canonicalContactKey(phoneA));
  const kindB = identityKind(canonicalContactKey(phoneB));
  return Boolean(kindA && kindB && kindA !== kindB);
}

/**
 * One WhatsApp person can have at most three rows (E.164, LID, @username).
 * Merge only when every row's phone key is on THIS payload and the kinds
 * are complementary — never merge two E.164s or a grab-bag of handles.
 */
export function isProvenPeerPair(
  a: ExistingContact,
  b: ExistingContact,
  options: PeerMergeOptions = {},
): boolean {
  const keyA = canonicalContactKey(a.phone);
  const keyB = canonicalContactKey(b.phone);
  if (!keyA || !keyB || keyA === keyB) return false;

  const kindA = identityKind(keyA);
  const kindB = identityKind(keyB);
  if (!kindA || !kindB || kindA === kindB) return false;

  const aliases = new Set(
    [
      ...(options.aliases ?? []),
      options.lid ? `lid:${options.lid.replace(/\D/g, '')}` : '',
      options.username
        ? `user:${canonicalizeWhatsAppUsername(options.username)}`
        : '',
    ]
      .map((value) => canonicalContactKey(value))
      .filter(Boolean),
  );
  if (!aliases.has(keyA) || !aliases.has(keyB)) return false;

  const lidKey = options.lid
    ? canonicalContactKey(`lid:${options.lid.replace(/\D/g, '')}`)
    : '';
  const userKey = options.username
    ? canonicalContactKey(`user:${canonicalizeWhatsAppUsername(options.username)}`)
    : '';
  if (lidKey) {
    if (kindA === 'lid' && keyA !== lidKey) return false;
    if (kindB === 'lid' && keyB !== lidKey) return false;
  }
  if (userKey) {
    if (kindA === 'user' && keyA !== userKey) return false;
    if (kindB === 'user' && keyB !== userKey) return false;
  }

  const hasHandleHint = Boolean(lidKey || userKey);
  if (!hasHandleHint && (kindA === 'phone' || kindB === 'phone')) {
    return false;
  }
  return true;
}

function areComplementaryIdentities(contacts: ExistingContact[]): boolean {
  if (contacts.length < 2 || contacts.length > 3) return false;
  const seen: Record<'user' | 'lid' | 'phone', number> = {
    user: 0,
    lid: 0,
    phone: 0,
  };
  for (const contact of contacts) {
    const kind = identityKind(canonicalContactKey(contact.phone));
    if (!kind) return false;
    seen[kind] += 1;
    if (seen[kind] > 1) return false;
  }
  return seen.phone + seen.lid + seen.user === contacts.length;
}

/**
 * Pick who to keep and who (if anyone) may be absorbed. Multiple LIDs or
 * multiple E.164s are refused — that was the N-way merge that dumped
 * every LID/phone pair into a single conversation. At most one row of
 * each kind (phone, LID, @username) for the same payload may merge.
 */
export function selectMergeableLosers(
  matches: ExistingContact[],
  primaryKey: string,
  options: PeerMergeOptions = {},
): { survivor: ExistingContact; losers: ExistingContact[] } {
  if (matches.length === 0) {
    throw new Error('selectMergeableLosers requires at least one contact');
  }
  if (matches.length === 1) {
    return { survivor: matches[0], losers: [] };
  }

  const payloadKeys = [
    primaryKey,
    ...(options.aliases ?? []),
    options.lid ? `lid:${options.lid}` : '',
    options.username ? `user:${options.username}` : '',
  ];
  const onPayload = matches.filter((contact) =>
    isContactOnPayload(contact, payloadKeys),
  );
  const scoped = onPayload.length > 0 ? onPayload : matches.slice(0, 1);

  const preferred = canonicalContactKey(primaryKey);
  const fallback =
    scoped.find((c) => canonicalContactKey(c.phone) === preferred) ??
    pickSurvivorContact(scoped, primaryKey);

  if (!areComplementaryIdentities(scoped)) {
    return { survivor: fallback, losers: [] };
  }

  const hasPhone = scoped.some(
    (c) => identityKind(canonicalContactKey(c.phone)) === 'phone',
  );
  if (hasPhone && !options.lid && !options.username) {
    return { survivor: fallback, losers: [] };
  }

  for (let i = 0; i < scoped.length; i += 1) {
    for (let j = i + 1; j < scoped.length; j += 1) {
      if (
        !isProvenPeerPair(scoped[i], scoped[j], {
          ...options,
          aliases: payloadKeys,
        })
      ) {
        return { survivor: fallback, losers: [] };
      }
    }
  }

  const survivor = pickSurvivorContact(scoped, primaryKey);
  return {
    survivor,
    losers: scoped.filter((c) => c.id !== survivor.id),
  };
}

/**
 * When a LID inbound and a PN outbound are the same WhatsApp person,
 * two contact rows + two conversations exist. Collapse them onto one
 * contact and one conversation per channel, moving messages so the
 * inbox shows both sides.
 */
export async function mergePeerContacts(
  db: SupabaseClient,
  survivor: ExistingContact,
  losers: ExistingContact[],
): Promise<ExistingContact> {
  for (const loser of losers) {
    if (loser.id === survivor.id) continue;
    await mergeConversationsOntoSurvivor(db, survivor.id, loser.id);
    await repointContactChildren(db, survivor.id, loser.id);
    await db.from('contacts').delete().eq('id', loser.id);
  }
  await stampMergedIdentity(db, survivor, losers);
  const { data: refreshed } = await db
    .from('contacts')
    .select('*')
    .eq('id', survivor.id)
    .maybeSingle();
  return (refreshed as ExistingContact | null) ?? survivor;
}

export function pickComplementaryNameTwin(
  incomingKey: string,
  incomingName: string,
  candidates: ExistingContact[],
): ExistingContact | null {
  const name = incomingName.trim();
  if (!name) return null;
  const hasEmoji = /\p{Extended_Pictographic}/u.test(name);
  if (!hasEmoji && name.length < 2) return null;
  if (/^(lid:|user:|@)/i.test(name) || /@lid$/i.test(name)) return null;
  if (/^\d{6,}$/.test(name)) return null;

  const key = canonicalContactKey(incomingKey);
  if (!key) return null;
  const incomingHandle = isWhatsAppHandleKey(key);
  const needle = normalizePeerDisplayName(name);
  if (!needle) return null;

  const sameName = candidates.filter((c) => {
    const n = normalizePeerDisplayName(c.name ?? '');
    if (n !== needle) return false;
    return canonicalContactKey(c.phone) !== key;
  });
  if (sameName.length !== 1) return null;
  const twin = sameName[0];
  const twinHandle = isWhatsAppHandleKey(canonicalContactKey(twin.phone));
  if (incomingHandle === twinHandle) return null;
  return twin;
}

/** WhatsApp often sends ⚽ vs ⚽️; treat them as the same pushName. */
export function normalizePeerDisplayName(
  name: string | null | undefined,
): string {
  if (!name) return '';
  return name.replace(/\uFE0F/g, '').replace(/\u200D/g, '').trim().toLowerCase();
}

/**
 * LID row `lid:X` + E.164 row whose `whatsapp_lid` is X — same person
 * even when their display names differ (number vs emoji).
 */
export function listStampedLidPairs(
  contacts: ExistingContact[],
): Array<{ survivor: ExistingContact; loser: ExistingContact }> {
  const pairs: Array<{ survivor: ExistingContact; loser: ExistingContact }> = [];
  const seen = new Set<string>();
  for (const a of contacts) {
    const lidA = lidFromContact(a);
    if (!lidA) continue;
    const kindA = identityKind(canonicalContactKey(a.phone));
    if (!kindA) continue;
    for (const b of contacts) {
      if (a.id === b.id) continue;
      if (lidFromContact(b) !== lidA) continue;
      const kindB = identityKind(canonicalContactKey(b.phone));
      if (!kindB || kindA === kindB) continue;
      const survivor = pickSurvivorContact([a, b], a.phone);
      const loser = survivor.id === a.id ? b : a;
      const id = [survivor.id, loser.id].sort().join(':');
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push({ survivor, loser });
    }
  }
  return pairs;
}

/**
 * Unique same-name pairs that are complementary (one E.164, one
 * LID/@username). Used to join chats that Evolution already split
 * before a payload listed both identities.
 */
export function listComplementaryNameTwinPairs(
  contacts: ExistingContact[],
): Array<{ survivor: ExistingContact; loser: ExistingContact }> {
  const byName = new Map<string, ExistingContact[]>();
  for (const contact of contacts) {
    const n = normalizePeerDisplayName(contact.name ?? '');
    if (!n) continue;
    const hasEmoji = /\p{Extended_Pictographic}/u.test(n);
    if (!hasEmoji && n.length < 2) continue;
    if (/^(lid:|user:|@)/i.test(n) || /@lid$/i.test(n)) continue;
    if (/^\d{6,}$/.test(n)) continue;
    const list = byName.get(n) ?? [];
    list.push(contact);
    byName.set(n, list);
  }

  const pairs: Array<{ survivor: ExistingContact; loser: ExistingContact }> = [];
  for (const group of byName.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    const twin = pickComplementaryNameTwin(a.phone, a.name ?? '', [b]);
    if (!twin) continue;
    const survivor = pickSurvivorContact([a, b], a.phone);
    const loser = survivor.id === a.id ? b : a;
    pairs.push({ survivor, loser });
  }
  return pairs;
}

export interface SharedProviderMessageRow {
  messageId: string;
  conversationId: string;
  contactId: string;
  contactPhone: string;
  channel: string;
}

/**
 * Same WhatsApp message id on two complementary contacts (LID vs phone)
 * is the same person — never two customers. Two E.164s sharing an id
 * are left alone.
 */
export function listSharedProviderMessagePairs(
  rows: SharedProviderMessageRow[],
): Array<{ survivor: ExistingContact; loserId: string; homeConversationId: string }> {
  const byId = new Map<string, SharedProviderMessageRow[]>();
  for (const row of rows) {
    if (!row.messageId) continue;
    const key = `${row.channel}::${row.messageId}`;
    const list = byId.get(key) ?? [];
    list.push(row);
    byId.set(key, list);
  }
  const pairs: Array<{
    survivor: ExistingContact;
    loserId: string;
    homeConversationId: string;
  }> = [];
  const seen = new Set<string>();
  for (const group of byId.values()) {
    const uniqueContacts = new Map<string, SharedProviderMessageRow>();
    for (const row of group) uniqueContacts.set(row.contactId, row);
    if (uniqueContacts.size !== 2) continue;
    const [a, b] = [...uniqueContacts.values()];
    if (!areComplementaryContactPhones(a.contactPhone, b.contactPhone)) continue;
    const contacts = [
      { id: a.contactId, phone: a.contactPhone },
      { id: b.contactId, phone: b.contactPhone },
    ];
    const survivor = pickSurvivorContact(contacts, a.contactPhone);
    const loser = survivor.id === a.contactId ? b : a;
    const id = [survivor.id, loser.contactId].sort().join(':');
    if (seen.has(id)) continue;
    seen.add(id);
    pairs.push({
      survivor,
      loserId: loser.contactId,
      homeConversationId: survivor.id === a.contactId ? a.conversationId : b.conversationId,
    });
  }
  return pairs;
}

export async function repairComplementaryNameSplits(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  const { data, error } = await db
    .from('contacts')
    .select('id, phone, name, whatsapp_lid, whatsapp_username')
    .eq('account_id', accountId);
  if (error || !data?.length) return 0;

  const contacts = data as ExistingContact[];
  const pairs = [...listStampedLidPairs(contacts), ...listComplementaryNameTwinPairs(contacts)];
  const seenLoser = new Set<string>();
  let merged = 0;
  for (const { survivor, loser } of pairs) {
    if (seenLoser.has(loser.id) || survivor.id === loser.id) continue;
    seenLoser.add(loser.id);
    await mergePeerContacts(db, survivor, [loser]);
    merged += 1;
  }
  merged += await repairSharedProviderMessageSplits(db, accountId, contacts);
  return merged;
}

async function repairSharedProviderMessageSplits(
  db: SupabaseClient,
  accountId: string,
  contacts: ExistingContact[],
): Promise<number> {
  const { data: convos } = await db
    .from('conversations')
    .select('id, contact_id, whatsapp_config_id')
    .eq('account_id', accountId);
  if (!convos?.length) return 0;
  const convById = new Map(
    convos.map((c) => [
      c.id as string,
      {
        contactId: c.contact_id as string,
        channel: String(c.whatsapp_config_id ?? '__null__'),
      },
    ]),
  );
  const convIds = [...convById.keys()];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: msgs } = await db
    .from('messages')
    .select('message_id, conversation_id')
    .in('conversation_id', convIds)
    .not('message_id', 'is', null)
    .gte('created_at', since)
    .limit(2000);
  if (!msgs?.length) return 0;
  const byContact = new Map(contacts.map((c) => [c.id, c]));
  const rows: SharedProviderMessageRow[] = [];
  for (const msg of msgs) {
    const conv = convById.get(msg.conversation_id as string);
    if (!conv) continue;
    const contact = byContact.get(conv.contactId);
    if (!contact) continue;
    rows.push({
      messageId: String(msg.message_id),
      conversationId: msg.conversation_id as string,
      contactId: conv.contactId,
      contactPhone: contact.phone,
      channel: conv.channel,
    });
  }
  let merged = 0;
  const seenLoser = new Set<string>();
  for (const pair of listSharedProviderMessagePairs(rows)) {
    if (seenLoser.has(pair.loserId)) continue;
    const loser = byContact.get(pair.loserId);
    if (!loser) continue;
    seenLoser.add(pair.loserId);
    await mergePeerContacts(db, pair.survivor, [loser]);
    merged += 1;
  }
  return merged;
}

export function lidFromContact(contact: ExistingContact): string {
  const key = canonicalContactKey(contact.phone);
  if (key.startsWith('lid:')) return key.slice(4);
  return String(contact.whatsapp_lid ?? '').replace(/\D/g, '');
}

export function usernameFromContact(contact: ExistingContact): string {
  const key = canonicalContactKey(contact.phone);
  if (key.startsWith('user:')) return key.slice(5);
  const raw = String(contact.whatsapp_username ?? '').trim();
  return raw ? canonicalizeWhatsAppUsername(raw) : '';
}

export function pickSurvivorContact(
  contacts: ExistingContact[],
  preferredKey: string,
): ExistingContact {
  const e164 = contacts.find((c) => {
    const key = canonicalContactKey(c.phone);
    return Boolean(key) && !isWhatsAppHandleKey(key);
  });
  if (e164) return e164;

  const preferred = canonicalContactKey(preferredKey);
  const byKey = contacts.find(
    (c) => canonicalContactKey(c.phone) === preferred,
  );
  if (byKey) return byKey;
  return contacts[0];
}

/** Rewrite a stored LID/@username key to E.164 once the phone is known. */
export function preferE164ContactPhone(
  existingPhone: string,
  incomingKey: string,
): string | null {
  const incoming = canonicalContactKey(incomingKey);
  const existing = canonicalContactKey(existingPhone);
  if (!incoming || !existing) return null;
  if (isWhatsAppHandleKey(incoming)) return null;
  if (existing === incoming) return null;
  if (!isWhatsAppHandleKey(existing)) return null;
  return incoming;
}

export function contactNameLooksLikeId(
  name: string | null | undefined,
  phone: string,
): boolean {
  return nameLooksLikeId(name, phone);
}

function nameLooksLikeId(name: string | null | undefined, phone: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (n === phone) return true;
  if (/^\d{8,}$/.test(n)) return true;
  if (/^lid:/i.test(n) || /^user:/i.test(n)) return true;
  return false;
}

async function stampMergedIdentity(
  db: SupabaseClient,
  survivor: ExistingContact,
  losers: ExistingContact[],
): Promise<void> {
  const patch: Record<string, unknown> = {};
  let name = (survivor.name as string | null | undefined) ?? '';
  let lid =
    (survivor.whatsapp_lid as string | null | undefined) ??
    (canonicalContactKey(survivor.phone).startsWith('lid:')
      ? canonicalContactKey(survivor.phone).slice(4)
      : '');
  let username =
    (survivor.whatsapp_username as string | null | undefined) ??
    (canonicalContactKey(survivor.phone).startsWith('user:')
      ? canonicalContactKey(survivor.phone).slice(5)
      : '');

  for (const loser of losers) {
    if (
      nameLooksLikeId(name, survivor.phone) &&
      loser.name &&
      !nameLooksLikeId(loser.name, loser.phone)
    ) {
      name = loser.name;
    }
    const loserKey = canonicalContactKey(loser.phone);
    const loserLid =
      (loser.whatsapp_lid as string | null | undefined) ||
      (loserKey.startsWith('lid:') ? loserKey.slice(4) : '');
    const loserUser =
      (loser.whatsapp_username as string | null | undefined) ||
      (loserKey.startsWith('user:') ? loserKey.slice(5) : '');
    if (!lid && loserLid) lid = loserLid;
    if (!username && loserUser) username = loserUser;
  }

  if (name && name !== survivor.name) patch.name = name;
  if (lid && lid !== survivor.whatsapp_lid) patch.whatsapp_lid = lid;
  if (username && username !== survivor.whatsapp_username) {
    patch.whatsapp_username = username;
  }
  if (Object.keys(patch).length === 0) return;
  patch.updated_at = new Date().toISOString();
  await db.from('contacts').update(patch).eq('id', survivor.id);
}

async function mergeConversationsOntoSurvivor(
  db: SupabaseClient,
  survivorContactId: string,
  loserContactId: string,
): Promise<void> {
  const { data: survivorConvos } = await db
    .from('conversations')
    .select('id, whatsapp_config_id, last_message_at, unread_count, last_message_text')
    .eq('contact_id', survivorContactId);
  const { data: loserConvos } = await db
    .from('conversations')
    .select('id, whatsapp_config_id, last_message_at, unread_count, last_message_text')
    .eq('contact_id', loserContactId);

  type ConvoRow = {
    id: string;
    whatsapp_config_id: string | null;
    last_message_at: string | null;
    unread_count: number | null;
    last_message_text: string | null;
  };
  const survivorByChannel = new Map<string, ConvoRow>();
  for (const row of (survivorConvos ?? []) as ConvoRow[]) {
    survivorByChannel.set(channelKey(row.whatsapp_config_id), row);
  }

  for (const loser of (loserConvos ?? []) as ConvoRow[]) {
    const channel = channelKey(loser.whatsapp_config_id);
    const survivorConv = survivorByChannel.get(channel);
    if (!survivorConv) {
      await db
        .from('conversations')
        .update({ contact_id: survivorContactId })
        .eq('id', loser.id);
      continue;
    }

    const { data: messages } = await db
      .from('messages')
      .select('id, message_id')
      .eq('conversation_id', loser.id);

    for (const msg of messages ?? []) {
      const { error } = await db
        .from('messages')
        .update({ conversation_id: survivorConv.id })
        .eq('id', msg.id);
      if (error && !isUniqueViolation(error)) {
        console.error('[merge-peer] failed to move message', error);
      }
    }

    const unread =
      (Number(survivorConv.unread_count) || 0) +
      (Number(loser.unread_count) || 0);
    const survivorAt = survivorConv.last_message_at
      ? Date.parse(String(survivorConv.last_message_at))
      : 0;
    const loserAt = loser.last_message_at
      ? Date.parse(String(loser.last_message_at))
      : 0;
    const useLoserPreview = loserAt > survivorAt;

    await db
      .from('conversations')
      .update({
        unread_count: unread,
        last_message_at: useLoserPreview
          ? loser.last_message_at
          : survivorConv.last_message_at,
        last_message_text: useLoserPreview
          ? loser.last_message_text
          : survivorConv.last_message_text,
        updated_at: new Date().toISOString(),
      })
      .eq('id', survivorConv.id);

    await db.from('conversations').delete().eq('id', loser.id);
  }
}

function channelKey(id: string | null | undefined): string {
  return id ?? '__null__';
}

async function repointContactChildren(
  db: SupabaseClient,
  survivorId: string,
  loserId: string,
): Promise<void> {
  const tables = [
    'contact_notes',
    'deals',
    'broadcast_recipients',
    'automation_logs',
    'automation_pending_executions',
    'notifications',
  ] as const;
  for (const table of tables) {
    await db.from(table).update({ contact_id: survivorId }).eq('contact_id', loserId);
  }

  const { data: loserTags } = await db
    .from('contact_tags')
    .select('id, tag_id')
    .eq('contact_id', loserId);
  for (const tag of loserTags ?? []) {
    const { error } = await db
      .from('contact_tags')
      .update({ contact_id: survivorId })
      .eq('id', tag.id);
    if (error) {
      await db.from('contact_tags').delete().eq('id', tag.id);
    }
  }

  const { data: loserVals } = await db
    .from('contact_custom_values')
    .select('id, custom_field_id')
    .eq('contact_id', loserId);
  for (const row of loserVals ?? []) {
    const { error } = await db
      .from('contact_custom_values')
      .update({ contact_id: survivorId })
      .eq('id', row.id);
    if (error) {
      await db.from('contact_custom_values').delete().eq('id', row.id);
    }
  }

  await db
    .from('flow_runs')
    .update({ contact_id: survivorId })
    .eq('contact_id', loserId)
    .neq('status', 'active');
}
