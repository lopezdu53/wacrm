/**
 * WhatsApp peer identity for Evolution/Baileys.
 *
 * Phone-number chats stay on E.164 digits. WhatsApp @username accounts
 * (no visible phone) and LID-only chats (`123@lid`) must NOT be stored
 * as stripped digits — `1E4NDRA` → `14` and last-8 LID matching merge
 * unrelated people into one contact.
 *
 * Contact keys:
 *   - `{digits}`           real phone
 *   - `user:{username}`    @username (canonical lowercase)
 *   - `lid:{id}`           LID when no phone and no username
 *
 * The Evolution webhook `sender` field is the linked *instance*, not
 * the customer. Never use it as identity.
 */

import {
  canonicalContactKey,
  canonicalizeWhatsAppUsername,
  isValidE164,
  isWhatsAppHandleKey,
  isWhatsAppUsername,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

export interface EvolutionPeer {
  contactKey: string;
  phone: string | null;
  lid: string | null;
  username: string | null;
}

export interface EvolutionPeerSource {
  key?: {
    remoteJid?: string;
    remoteJidAlt?: string;
    previousRemoteJid?: string;
    senderPn?: string;
    senderLid?: string;
    participant?: string;
    participantAlt?: string;
    participantPn?: string;
    participantLid?: string;
    remoteJidUsername?: string;
    participantUsername?: string;
    addressingMode?: string;
    fromMe?: boolean;
    id?: string;
  };
  senderPn?: string;
  senderLid?: string;
  remoteJidAlt?: string;
  previousRemoteJid?: string;
  lid?: string;
  pushName?: string;
}

type JidKind = 'phone' | 'lid' | 'username' | 'group' | 'other';

interface ParsedJid {
  kind: JidKind;
  user: string;
}

function parseJid(jid: string | undefined | null): ParsedJid | null {
  if (!jid || typeof jid !== 'string') return null;
  const trimmed = jid.trim();
  if (!trimmed) return null;
  const at = trimmed.indexOf('@');
  const user = (at >= 0 ? trimmed.slice(0, at) : trimmed).trim();
  const host = at >= 0 ? trimmed.slice(at).toLowerCase() : '';
  if (!user) return null;

  if (host === '@g.us' || host === '@broadcast' || host === '@newsletter') {
    return { kind: 'group', user };
  }
  const digitUser = user.replace(/\D/g, '');
  // LIDs are 16+ digits and may arrive as @lid or wrongly as @s.whatsapp.net.
  if (host === '@lid' || /^\d{16,}$/.test(digitUser)) {
    return digitUser ? { kind: 'lid', user: digitUser } : null;
  }
  // Bare values (webhook `sender` / instance name) are phones only.
  // A @username always arrives with @s.whatsapp.net or on
  // remoteJidUsername — never treat "ventas" as a customer handle.
  if (!host) {
    if (/^\d{8,15}$/.test(user)) return { kind: 'phone', user };
    return null;
  }
  if (host !== '@s.whatsapp.net' && host !== '@c.us') {
    return { kind: 'other', user };
  }

  if (/^\d{8,15}$/.test(user)) return { kind: 'phone', user };
  if (isWhatsAppUsername(user)) {
    return { kind: 'username', user: canonicalizeWhatsAppUsername(user) };
  }
  return { kind: 'other', user };
}

function usernameFromField(value: string | undefined | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const u = canonicalizeWhatsAppUsername(value);
  return isWhatsAppUsername(u) ? u : null;
}

/**
 * Identify the 1:1 peer on an Evolution/Baileys upsert.
 *
 * Collect every LID / phone / @username on the payload as aliases so
 * inbound LID and outbound PN merge into one contact. Canonical key
 * prefers @username, then LID, then E.164 — a fromMe send addressed to
 * the phone still has to land on the LID chat the customer replies in.
 */
export function resolveEvolutionPeer(
  item: EvolutionPeerSource,
): EvolutionPeer | null {
  const key = item.key ?? {};
  const chat = parseJid(key.remoteJid);
  if (chat?.kind === 'group') return null;

  const jids = collectJidCandidates(item);

  let phone: string | null = null;
  let lid: string | null = chat?.kind === 'lid' ? chat.user : null;
  let username =
    usernameFromField(key.remoteJidUsername) ??
    usernameFromField(key.participantUsername);

  for (const candidate of jids) {
    const parsed = parseJid(candidate);
    if (!parsed || parsed.kind === 'group' || parsed.kind === 'other') continue;
    if (parsed.kind === 'phone' && !phone) phone = parsed.user;
    else if (parsed.kind === 'lid' && !lid) lid = parsed.user;
    else if (parsed.kind === 'username' && !username) username = parsed.user;
  }

  if (!username && item.pushName?.trim().startsWith('@')) {
    username = usernameFromField(item.pushName);
  }

  if (!username && chat?.kind === 'username') username = chat.user;
  if (!phone && chat?.kind === 'phone') phone = chat.user;

  // Username, then LID, then phone. A fromMe echo addressed to the
  // E.164 still has to land on the LID/@username contact the customer
  // replies on — chat-JID-first kept agent greens on the phone window.
  let contactKey = '';
  if (username) {
    contactKey = `user:${username}`;
  } else if (lid) {
    contactKey = `lid:${lid}`;
  } else if (phone) {
    contactKey = phone;
  } else if (chat?.kind === 'username') {
    contactKey = `user:${chat.user}`;
  } else if (chat?.kind === 'lid') {
    contactKey = `lid:${chat.user}`;
  } else if (chat?.kind === 'phone') {
    contactKey = chat.user;
  }

  if (!contactKey) return null;
  return { contactKey, phone, lid, username };
}

/**
 * Only envelope identity fields. Walking the whole payload picked up
 * quoted participants and leftover history JIDs, then merged those
 * people into one contact.
 */
function collectJidCandidates(item: EvolutionPeerSource): string[] {
  const key = item.key ?? {};
  const values = [
    key.remoteJid,
    key.remoteJidAlt,
    key.previousRemoteJid,
    key.senderPn,
    key.senderLid,
    key.participant,
    key.participantAlt,
    key.participantPn,
    key.participantLid,
    key.remoteJidUsername
      ? `${key.remoteJidUsername}@s.whatsapp.net`
      : undefined,
    key.participantUsername
      ? `${key.participantUsername}@s.whatsapp.net`
      : undefined,
    item.senderPn,
    item.senderLid,
    item.remoteJidAlt,
    item.previousRemoteJid,
    item.lid ? `${item.lid}@lid` : undefined,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const t = value.trim();
    if (!t || seen.has(t) || t.length > 128) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Every stored key that might already identify this peer. */
export function peerLookupKeys(peer: EvolutionPeer): string[] {
  const raw: string[] = [];
  const add = (value: string | null | undefined) => {
    if (value && value.trim()) raw.push(value.trim());
  };
  if (peer.username) {
    add(`user:${peer.username}`);
    add(peer.username);
    add(`@${peer.username}`);
  }
  if (peer.lid) {
    add(`lid:${peer.lid}`);
    add(peer.lid);
  }
  add(peer.phone);
  add(peer.contactKey);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const key = canonicalContactKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Keep only the missing half of this identity (at most one phone, one
 * LID, one @username). A grab-bag of Evolution contacts — findContacts
 * sometimes returns every row — must not become merge aliases.
 */
export function complementaryIdentityKeys(
  peer: EvolutionPeer,
  keys: Iterable<string>,
): string[] {
  const own = new Set(peerLookupKeys(peer));
  const phones: string[] = [];
  const lids: string[] = [];
  const users: string[] = [];
  const seen = new Set<string>();

  for (const raw of keys) {
    const key = canonicalContactKey(raw);
    if (!key || own.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (key.startsWith('user:')) users.push(key);
    else if (key.startsWith('lid:') || isWhatsAppHandleKey(key)) lids.push(key);
    else phones.push(key);
  }

  if (phones.length > 1 || lids.length > 1 || users.length > 1) return [];

  const out: string[] = [];
  if (!peer.phone && phones.length === 1) out.push(phones[0]);
  if (!peer.lid && lids.length === 1) out.push(lids[0]);
  if (!peer.username && users.length === 1) out.push(users[0]);
  return out;
}

/**
 * Value Evolution's `number` field expects: digits, `{lid}@lid`, or
 * a bare @username. Never strip letters out of a username.
 */
export function toEvolutionRecipient(stored: string): string {
  const raw = stored.trim();
  if (!raw) return '';

  const key = canonicalContactKey(raw);
  if (key.startsWith('lid:')) {
    const lid = key.slice(4);
    return lid ? `${lid}@lid` : '';
  }
  if (key.startsWith('user:')) return key.slice(5);

  if (/@lid$/i.test(raw)) {
    const lid = raw.slice(0, raw.indexOf('@')).replace(/\D/g, '');
    return lid ? `${lid}@lid` : '';
  }

  const digits = sanitizePhoneForMeta(raw);
  if (digits) return digits;

  if (isWhatsAppUsername(raw)) return canonicalizeWhatsAppUsername(raw);
  return '';
}

/** remoteJid for Evolution findMessages / history sync. */
export function contactKeyToRemoteJid(phone: string): string | null {
  const dest = toEvolutionRecipient(phone);
  if (!dest) return null;
  if (dest.includes('@')) return dest;
  if (/^\d{8,15}$/.test(dest)) return `${dest}@s.whatsapp.net`;
  if (isWhatsAppUsername(dest)) return `${dest}@s.whatsapp.net`;
  return null;
}

export type OutboundRecipient =
  | {
      ok: true;
      variants: string[];
      baseline: string;
      isHandle: boolean;
    }
  | { ok: false; error: string };

/**
 * Who to send to, given a contact.phone and the channel provider.
 * Meta Cloud API only accepts E.164; Evolution also accepts @username
 * and `{lid}@lid`.
 */
export function resolveOutboundRecipient(
  contactPhone: string,
  isEvolution: boolean,
  extras?: { lid?: string | null; username?: string | null },
): OutboundRecipient {
  if (isEvolution) {
    const username = extras?.username
      ? canonicalizeWhatsAppUsername(extras.username)
      : '';
    if (username && isWhatsAppUsername(username)) {
      return {
        ok: true,
        variants: [username],
        baseline: canonicalContactKey(contactPhone) || `user:${username}`,
        isHandle: true,
      };
    }
    const lidDigits = (extras?.lid ?? '').replace(/\D/g, '');
    if (lidDigits) {
      return {
        ok: true,
        variants: [`${lidDigits}@lid`],
        baseline: canonicalContactKey(contactPhone) || `lid:${lidDigits}`,
        isHandle: true,
      };
    }
  }

  if (isWhatsAppHandleKey(contactPhone)) {
    if (!isEvolution) {
      return {
        ok: false,
        error:
          'This contact uses a WhatsApp @username. Replies must go out an Evolution (QR) number.',
      };
    }
    const recipient = toEvolutionRecipient(contactPhone);
    if (!recipient) {
      return { ok: false, error: 'Invalid WhatsApp username or LID' };
    }
    return {
      ok: true,
      variants: [recipient],
      baseline: canonicalContactKey(contactPhone),
      isHandle: true,
    };
  }

  const sanitized = sanitizePhoneForMeta(contactPhone);
  if (!isValidE164(sanitized)) {
    return { ok: false, error: 'Invalid phone number format' };
  }
  return {
    ok: true,
    variants: isEvolution ? [sanitized] : phoneVariants(sanitized),
    baseline: sanitized,
    isHandle: false,
  };
}
