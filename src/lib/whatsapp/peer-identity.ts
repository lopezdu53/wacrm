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
    senderPn?: string;
    participant?: string;
    participantAlt?: string;
    remoteJidUsername?: string;
    participantUsername?: string;
    fromMe?: boolean;
    id?: string;
  };
  senderPn?: string;
  remoteJidAlt?: string;
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
  if (host === '@lid') {
    const lid = user.replace(/\D/g, '');
    return lid ? { kind: 'lid', user: lid } : null;
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
 * Prefers a real phone, then @username, then LID. Groups and the
 * instance envelope are ignored.
 */
export function resolveEvolutionPeer(
  item: EvolutionPeerSource,
): EvolutionPeer | null {
  const key = item.key ?? {};
  const jids = [
    key.remoteJid,
    key.remoteJidAlt,
    key.senderPn,
    item.senderPn,
    item.remoteJidAlt,
    key.participant,
    key.participantAlt,
  ];

  let phone: string | null = null;
  let lid: string | null = null;
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

  const contactKey = phone
    ? phone
    : username
      ? `user:${username}`
      : lid
        ? `lid:${lid}`
        : '';

  if (!contactKey) return null;
  return { contactKey, phone, lid, username };
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
): OutboundRecipient {
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
