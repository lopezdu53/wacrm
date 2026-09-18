// ============================================================
// Shared Evolution → wacrm inbound processing.
//
// One message-item pipeline used by BOTH the live webhook and the
// on-demand "sync" backfill, so a message recorded either way is
// identical. Parsing (text / media / vCard), media upload, the skip
// rule, and the call into the transport-neutral `recordInboundMessage`
// all live here.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { recordInboundMessage, findOrCreateContact } from '@/lib/whatsapp/inbound-core';
import { resolveEvolutionPeer, peerLookupKeys, contactKeyToRemoteJid, type EvolutionPeer } from '@/lib/whatsapp/peer-identity';
import { formatWhatsAppAddress, isWhatsAppHandleKey } from '@/lib/whatsapp/phone-utils';
import { vcardsToText } from '@/lib/whatsapp/vcard';
import { findContactsMatchingKeys } from '@/lib/contacts/dedupe';
import {
  findContactKeysByMessageIds,
  historyMessageIds,
  needsHistoryLink,
  remoteJidsForHistory,
} from '@/lib/whatsapp/peer-link';
import { fetchEvolutionMessages, type EvolutionHistoryItem } from '@/lib/whatsapp/evolution-api';

export const CONTENT_TYPE_BY_MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
} as const;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
};

/** Strip codec params: "audio/ogg; codecs=opus" → "audio/ogg". */
export function baseMime(mime: string | undefined): string | undefined {
  return mime?.split(';')[0].trim().toLowerCase();
}

export type BaileysMessage = Record<string, unknown>;

export interface UpsertData {
    key?: {
      remoteJid?: string;
      remoteJidAlt?: string;
      previousRemoteJid?: string;
      senderPn?: string;
      senderLid?: string;
      participant?: string;
      participantAlt?: string;
      remoteJidUsername?: string;
      participantUsername?: string;
      fromMe?: boolean;
      id?: string;
    };
  pushName?: string;
  message?: BaileysMessage;
  messageType?: string;
  messageTimestamp?: number | string | { low?: number };
  base64?: string;
  mediaBase64?: string;
  senderPn?: string;
  remoteJidAlt?: string;
  senderLid?: string;
}

/**
 * Phone digits from a WhatsApp PN JID, or null for LID / groups /
 * newsletters / @usernames. Usernames are not phones — extracting
 * `14` from `1E4NDRA` merges unrelated chats.
 */
export function phoneFromJid(jid: string | undefined | null): string | null {
  if (!jid || typeof jid !== 'string') return null;
  const at = jid.indexOf('@');
  const user = (at >= 0 ? jid.slice(0, at) : jid).trim();
  const host = at >= 0 ? jid.slice(at).toLowerCase() : '';
  if (!user) return null;
  if (
    host === '@lid' ||
    host === '@g.us' ||
    host === '@broadcast' ||
    host === '@newsletter'
  ) {
    return null;
  }
  if (host && host !== '@s.whatsapp.net' && host !== '@c.us') return null;
  // Bare values (webhook `sender` without a host) must be a phone, not
  // an Evolution instance name like "ventas" or a @username.
  if (!/^\d{8,15}$/.test(user)) return null;
  return user;
}

/**
 * Evolution/Baileys now often addresses 1:1 chats as `@lid`. The phone
 * lives on `remoteJidAlt` / `senderPn` when present. Groups stay skipped.
 * @username JIDs are not phones — use `resolveEvolutionPeer`.
 */
export function resolveEvolutionSenderPhone(item: UpsertData): string | null {
  return resolveEvolutionPeer(item)?.phone ?? null;
}

/** The bits of a whatsapp_config row the inbound pipeline needs. */
export interface EvoInboundConfig {
  id: string;
  account_id: string;
  user_id: string;
  evolution_base_url?: string | null;
  /** Already decrypted. */
  evolution_api_key?: string | null;
  evolution_instance?: string | null;
}

export function coerceTimestampMs(ts: UpsertData['messageTimestamp']): number {
  if (typeof ts === 'number') return ts * 1000;
  if (typeof ts === 'string') {
    const n = parseInt(ts, 10);
    return Number.isFinite(n) ? n * 1000 : Date.now();
  }
  if (ts && typeof ts === 'object' && typeof ts.low === 'number') {
    return ts.low * 1000;
  }
  return Date.now();
}

export interface ParsedBaileys {
  contentType: string;
  text: string | null;
  mediaKey: keyof typeof CONTENT_TYPE_BY_MEDIA | null;
  mimetype: string | undefined;
  fileName: string | undefined;
  interactiveReply?: { reply_id: string; reply_title: string };
  /** Quoted message's provider id (`contextInfo.stanzaId`). */
  replyToMetaMessageId?: string;
}

/** Walk a Baileys payload for a swipe-reply / quoted stanza id. */
export function extractContextStanzaId(msg: BaileysMessage): string | undefined {
  for (const value of Object.values(msg)) {
    if (!value || typeof value !== 'object') continue;
    const stanzaId = (value as { contextInfo?: { stanzaId?: string } })
      .contextInfo?.stanzaId;
    if (typeof stanzaId === 'string' && stanzaId) return stanzaId;
  }
  return undefined;
}

/** Pull text + media descriptor out of a Baileys message object. */
function withReply(
  parsed: ParsedBaileys,
  msg: BaileysMessage,
): ParsedBaileys {
  const replyTo = extractContextStanzaId(msg);
  return replyTo ? { ...parsed, replyToMetaMessageId: replyTo } : parsed;
}

export function parseBaileys(msg: BaileysMessage | undefined): ParsedBaileys {
  if (!msg) {
    return { contentType: 'text', text: null, mediaKey: null, mimetype: undefined, fileName: undefined };
  }

  if (typeof msg.conversation === 'string') {
    return withReply(
      { contentType: 'text', text: msg.conversation, mediaKey: null, mimetype: undefined, fileName: undefined },
      msg,
    );
  }
  const ext = msg.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) {
    return withReply(
      { contentType: 'text', text: ext.text, mediaKey: null, mimetype: undefined, fileName: undefined },
      msg,
    );
  }

  // Shared contact card(s) — flatten to a labelled text line.
  const contactMsg = msg.contactMessage as
    | { displayName?: string; vcard?: string }
    | undefined;
  if (contactMsg?.vcard || contactMsg?.displayName) {
    return withReply(
      { contentType: 'text', text: vcardsToText([contactMsg]), mediaKey: null, mimetype: undefined, fileName: undefined },
      msg,
    );
  }
  const contactsArr = msg.contactsArrayMessage as
    | { contacts?: { displayName?: string; vcard?: string }[] }
    | undefined;
  if (contactsArr?.contacts?.length) {
    return withReply(
      { contentType: 'text', text: vcardsToText(contactsArr.contacts), mediaKey: null, mimetype: undefined, fileName: undefined },
      msg,
    );
  }

  // Button / list replies (Evolution's rendering of interactive menus).
  const buttons = msg.buttonsResponseMessage as
    | { selectedButtonId?: string; selectedDisplayText?: string }
    | undefined;
  if (buttons?.selectedButtonId || buttons?.selectedDisplayText) {
    return withReply(
      {
        contentType: 'interactive',
        text: buttons.selectedDisplayText ?? buttons.selectedButtonId ?? null,
        mediaKey: null,
        mimetype: undefined,
        fileName: undefined,
        interactiveReply: {
          reply_id: buttons.selectedButtonId ?? buttons.selectedDisplayText ?? '',
          reply_title: buttons.selectedDisplayText ?? buttons.selectedButtonId ?? '',
        },
      },
      msg,
    );
  }
  const list = msg.listResponseMessage as
    | {
        title?: string;
        singleSelectReply?: { selectedRowId?: string };
      }
    | undefined;
  if (list?.singleSelectReply?.selectedRowId || list?.title) {
    const replyId = list.singleSelectReply?.selectedRowId ?? list.title ?? '';
    return withReply(
      {
        contentType: 'interactive',
        text: list.title ?? replyId,
        mediaKey: null,
        mimetype: undefined,
        fileName: undefined,
        interactiveReply: { reply_id: replyId, reply_title: list.title ?? replyId },
      },
      msg,
    );
  }

  // Documents can arrive wrapped in documentWithCaptionMessage.
  const wrapped = (msg.documentWithCaptionMessage as { message?: BaileysMessage } | undefined)?.message;
  const source = wrapped ?? msg;

  for (const key of Object.keys(CONTENT_TYPE_BY_MEDIA) as (keyof typeof CONTENT_TYPE_BY_MEDIA)[]) {
    const media = source[key] as
      | { caption?: string; mimetype?: string; fileName?: string }
      | undefined;
    if (media) {
      return withReply(
        {
          contentType: CONTENT_TYPE_BY_MEDIA[key],
          text: media.caption ?? null,
          mediaKey: key,
          mimetype: baseMime(media.mimetype),
          fileName: media.fileName,
        },
        { ...msg, ...source },
      );
    }
  }

  return withReply(
    { contentType: 'text', text: null, mediaKey: null, mimetype: undefined, fileName: undefined },
    msg,
  );
}

/**
 * Upload inbound media (base64) to the public chat-media bucket and
 * return its URL, or null when there's no base64 / the upload fails.
 */
export async function uploadInboundMedia(
  accountId: string,
  base64: string,
  contentType: string,
  mimetype: string | undefined,
): Promise<string | null> {
  const mime = mimetype ?? 'application/octet-stream';
  const ext = EXT_BY_MIME[mime] ?? 'bin';
  try {
    const buffer = Buffer.from(base64, 'base64');
    const path = `account-${accountId}/${Date.now()}-evo-${contentType}.${ext}`;
    const { error } = await supabaseAdmin()
      .storage.from('chat-media')
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (error) {
      console.error('[evolution-inbound] media upload failed:', error.message);
      return null;
    }
    const { data } = supabaseAdmin().storage.from('chat-media').getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.error('[evolution-inbound] media upload threw:', err);
    return null;
  }
}

/**
 * Process one Baileys message item into wacrm. Returns 'recorded',
 * 'skipped' (not a 1:1 user message, or nothing renderable), or
 * 'error'. `recordInboundMessage` dedups by provider id, so calling
 * this for a message already stored is a safe no-op — which is exactly
 * what makes the sync backfill idempotent.
 */
export async function processEvolutionItem(
  config: EvoInboundConfig,
  item: UpsertData,
): Promise<'recorded' | 'skipped' | 'error'> {
  try {
    const peer = resolveEvolutionPeer(item);
    if (!peer) {
      console.warn(
        '[evolution-inbound] skipped non-1:1 jid',
        item.key?.remoteJid,
      );
      return 'skipped';
    }

    const outbound = item.key?.fromMe === true;

    const parsed = parseBaileys(item.message);

    let mediaUrl: string | null = null;
    if (parsed.mediaKey) {
      const base64 =
        (item.message?.base64 as string | undefined) ??
        item.base64 ??
        item.mediaBase64 ??
        undefined;
      if (base64) {
        mediaUrl = await uploadInboundMedia(
          config.account_id,
          base64,
          parsed.contentType,
          parsed.mimetype,
        );
      }
    }

    // Nothing renderable and no text — skip (e.g. unsupported type).
    if (!parsed.text && !mediaUrl && parsed.contentType === 'text') return 'skipped';

    const fallbackName = formatWhatsAppAddress(peer.contactKey) || peer.contactKey;

    const historyKeys = await extraKeysFromEvolutionHistory(
      config,
      peer,
      item.key?.id,
    );

    await recordInboundMessage({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      senderPhone: peer.contactKey,
      identityAliases: [...peerLookupKeys(peer), ...historyKeys],
      whatsappLid: peer.lid,
      whatsappUsername: peer.username,
      contactName: outbound ? '' : (item.pushName ?? fallbackName),
      contentText:
        parsed.text ??
        (parsed.contentType === 'document' ? (parsed.fileName ?? null) : null),
      mediaUrl,
      contentType: parsed.contentType,
      messageId: item.key?.id ?? '',
      timestampMs: coerceTimestampMs(item.messageTimestamp),
      whatsappConfigId: config.id,
      outbound,
      interactiveReply: parsed.interactiveReply,
      replyToMetaMessageId: parsed.replyToMetaMessageId ?? null,
    });
    return 'recorded';
  } catch (err) {
    console.error('[evolution-inbound] failed to process item:', err);
    return 'error';
  }
}

/** Merge LID + phone from a contacts.upsert payload without inserting a message. */
export async function linkEvolutionPeerContact(
  config: EvoInboundConfig,
  item: UpsertData,
): Promise<void> {
  const peer = resolveEvolutionPeer(item);
  if (!peer) return;
  if (!peer.phone || !(peer.lid || peer.username)) return;
  await findOrCreateContact(
    config.account_id,
    config.user_id,
    peer.contactKey,
    item.pushName ?? '',
    {
      aliases: peerLookupKeys(peer),
      lid: peer.lid,
      username: peer.username,
    },
  );
}

async function extraKeysFromEvolutionHistory(
  config: EvoInboundConfig,
  peer: EvolutionPeer,
  inboundMessageId?: string,
): Promise<string[]> {
  try {
    const existing = await findContactsMatchingKeys(
      supabaseAdmin(),
      config.account_id,
      peerLookupKeys(peer),
    );
    if (!needsHistoryLink(peer, existing)) return [];
    if (
      !config.evolution_base_url ||
      !config.evolution_api_key ||
      !config.evolution_instance
    ) {
      return [];
    }

    const auth = {
      baseUrl: config.evolution_base_url,
      apiKey: config.evolution_api_key,
      instance: config.evolution_instance,
    };

    const items: EvolutionHistoryItem[] = [];
    for (const remoteJid of remoteJidsForHistory(peer)) {
      const batch = await fetchEvolutionMessages({
        ...auth,
        remoteJid,
        limit: 30,
        timeoutMs: 5000,
      });
      items.push(...batch);
      if (items.length >= 30) break;
    }
    const ids = historyMessageIds(items);
    const fromLidHistory = await findContactKeysByMessageIds(
      supabaseAdmin(),
      config.account_id,
      config.id,
      ids,
    );
    if (fromLidHistory.length > 0) return fromLidHistory;

    if (!inboundMessageId) return [];

    const { data: recent } = await supabaseAdmin()
      .from('conversations')
      .select('contact_id, contacts!inner(phone)')
      .eq('account_id', config.account_id)
      .eq('whatsapp_config_id', config.id)
      .order('last_message_at', { ascending: false })
      .limit(4);

    const phones = [
      ...new Set(
        (recent ?? [])
          .map((row) => {
            const contact = row.contacts as { phone?: string } | { phone?: string }[] | null;
            const phone = Array.isArray(contact) ? contact[0]?.phone : contact?.phone;
            return phone ?? '';
          })
          .filter((phone) => phone && !isWhatsAppHandleKey(phone)),
      ),
    ];

    const hits = await Promise.all(
      phones.map(async (phone) => {
        const jid = contactKeyToRemoteJid(phone);
        if (!jid) return null;
        const hist = await fetchEvolutionMessages({
          ...auth,
          remoteJid: jid,
          limit: 25,
          timeoutMs: 4000,
        });
        return historyMessageIds(hist).includes(inboundMessageId) ? phone : null;
      }),
    );
    return hits.filter((phone): phone is string => Boolean(phone));
  } catch (err) {
    console.warn('[evolution-inbound] history link failed:', err);
    return [];
  }
}
