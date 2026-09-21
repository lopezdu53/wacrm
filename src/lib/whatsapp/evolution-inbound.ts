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
import {
  complementaryIdentityKeys,
  peerLookupKeys,
  resolveEvolutionPeer,
  type EvolutionPeer,
} from '@/lib/whatsapp/peer-identity';
import { formatWhatsAppAddress } from '@/lib/whatsapp/phone-utils';
import { vcardsToText } from '@/lib/whatsapp/vcard';
import { findContactsMatchingKeys } from '@/lib/contacts/dedupe';
import {
  exclusiveLinkedKeys,
  findExclusiveAliasByMessageIds,
  needsHistoryLink,
  remoteJidsForHistory,
} from '@/lib/whatsapp/peer-link';
import {
  fetchEvolutionMediaBase64,
  fetchEvolutionMessages,
  fetchEvolutionIdentityAliases,
  stripMediaDataUrl,
  type EvolutionHistoryItem,
} from '@/lib/whatsapp/evolution-api';

export const CONTENT_TYPE_BY_MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  ptvMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
} as const;

const BAILEYS_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'futureProofMessage',
] as const;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mp4',
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

/**
 * WhatsApp Web / Baileys often wrap video (and some photos) in
 * ephemeral / view-once envelopes. Unwrap those so `videoMessage`
 * is visible. PTV (video notes) map onto `videoMessage`.
 */
export function unwrapBaileysMessage(
  msg: BaileysMessage | undefined,
): BaileysMessage | undefined {
  if (!msg) return msg;
  let current: BaileysMessage = msg;
  for (let depth = 0; depth < 5; depth++) {
    let inner: BaileysMessage | undefined;
    for (const key of BAILEYS_WRAPPERS) {
      const wrap = current[key];
      if (!wrap || typeof wrap !== 'object') continue;
      const nested = (wrap as { message?: BaileysMessage }).message;
      if (nested && typeof nested === 'object') {
        inner = nested;
        break;
      }
    }
    if (!inner) break;
    current = inner;
  }
  const ptv = current.ptvMessage;
  if (ptv && typeof ptv === 'object' && !current.videoMessage) {
    return { ...current, videoMessage: ptv };
  }
  return current;
}

export function parseBaileys(
  msg: BaileysMessage | undefined,
  messageType?: string | null,
): ParsedBaileys {
  const source = unwrapBaileysMessage(msg);
  if (!source) {
    return mediaTypeFallback(messageType);
  }

  if (typeof source.conversation === 'string' && source.conversation.trim()) {
    return withReply(
      { contentType: 'text', text: source.conversation, mediaKey: null, mimetype: undefined, fileName: undefined },
      source,
    );
  }
  const ext = source.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) {
    return withReply(
      { contentType: 'text', text: ext.text, mediaKey: null, mimetype: undefined, fileName: undefined },
      source,
    );
  }

  // Shared contact card(s) — flatten to a labelled text line.
  const contactMsg = source.contactMessage as
    | { displayName?: string; vcard?: string }
    | undefined;
  if (contactMsg?.vcard || contactMsg?.displayName) {
    return withReply(
      { contentType: 'text', text: vcardsToText([contactMsg]), mediaKey: null, mimetype: undefined, fileName: undefined },
      source,
    );
  }
  const contactsArr = source.contactsArrayMessage as
    | { contacts?: { displayName?: string; vcard?: string }[] }
    | undefined;
  if (contactsArr?.contacts?.length) {
    return withReply(
      { contentType: 'text', text: vcardsToText(contactsArr.contacts), mediaKey: null, mimetype: undefined, fileName: undefined },
      source,
    );
  }

  // Button / list replies (Evolution's rendering of interactive menus).
  const buttons = source.buttonsResponseMessage as
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
      source,
    );
  }
  const list = source.listResponseMessage as
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
      source,
    );
  }

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
        source,
      );
    }
  }

  const fallback = mediaTypeFallback(messageType);
  return withReply(fallback, source);
}

function mediaTypeFallback(messageType?: string | null): ParsedBaileys {
  const key = messageType as keyof typeof CONTENT_TYPE_BY_MEDIA | undefined;
  if (key && key in CONTENT_TYPE_BY_MEDIA) {
    return {
      contentType: CONTENT_TYPE_BY_MEDIA[key],
      text: null,
      mediaKey: key,
      mimetype: key === 'videoMessage' || key === 'ptvMessage' ? 'video/mp4' : undefined,
      fileName: undefined,
    };
  }
  return {
    contentType: 'text',
    text: null,
    mediaKey: null,
    mimetype: undefined,
    fileName: undefined,
  };
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
    const payload = stripMediaDataUrl(base64);
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) return null;
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

function inlineMediaBase64(item: UpsertData): string | undefined {
  const nested = item.message?.base64;
  if (typeof nested === 'string' && nested.trim()) return nested;
  if (typeof item.base64 === 'string' && item.base64.trim()) return item.base64;
  if (typeof item.mediaBase64 === 'string' && item.mediaBase64.trim()) {
    return item.mediaBase64;
  }
  return undefined;
}

async function resolveInboundMediaUrl(
  config: EvoInboundConfig,
  item: UpsertData,
  parsed: ParsedBaileys,
): Promise<string | null> {
  let raw = inlineMediaBase64(item);
  if (
    !raw &&
    config.evolution_base_url &&
    config.evolution_api_key &&
    config.evolution_instance
  ) {
    raw =
      (await fetchEvolutionMediaBase64({
        baseUrl: config.evolution_base_url,
        apiKey: config.evolution_api_key,
        instance: config.evolution_instance,
        item: {
          key: item.key,
          message: unwrapBaileysMessage(item.message) ?? item.message,
        },
        convertToMp4: parsed.contentType === 'video',
        timeoutMs: parsed.contentType === 'video' ? 45_000 : 20_000,
      })) ?? undefined;
  }
  if (!raw) return null;
  const mime =
    parsed.contentType === 'video'
      ? parsed.mimetype && parsed.mimetype.startsWith('video/')
        ? parsed.mimetype
        : 'video/mp4'
      : parsed.mimetype;
  return uploadInboundMedia(
    config.account_id,
    raw,
    parsed.contentType,
    mime,
  );
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

    const parsed = parseBaileys(item.message, item.messageType);

    let mediaUrl: string | null = null;
    if (parsed.mediaKey) {
      mediaUrl = await resolveInboundMediaUrl(config, item, parsed);
    }

    // Nothing renderable and no text — skip (e.g. unsupported type).
    // Media types still persist even if Evolution omitted the bytes;
    // the inbox can show a placeholder until a later sync fills them.
    if (!parsed.text && !mediaUrl && !parsed.mediaKey) return 'skipped';

    const fallbackName = formatWhatsAppAddress(peer.contactKey) || peer.contactKey;

    const historyKeys = await extraKeysFromOwnChatHistory(config, peer, [
      item.key?.id,
      parsed.replyToMetaMessageId,
    ]);
    let lid = peer.lid;
    let username = peer.username;
    for (const extra of historyKeys) {
      if (extra.startsWith('lid:') && !lid) lid = extra.slice(4);
      else if (extra.startsWith('user:') && !username) username = extra.slice(5);
    }

    await recordInboundMessage({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      senderPhone: peer.contactKey,
      identityAliases: [...peerLookupKeys(peer), ...historyKeys],
      whatsappLid: lid,
      whatsappUsername: username,
      contactName: outbound
        ? ''
        : (item.pushName ?? '').trim() || fallbackName,
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
      // Contact upserts often carry the instance / verified name, not
      // the customer. Never overwrite AL with "Envasadoras Colombia".
      allowRename: false,
    },
  );
}

const evolutionLinkInFlight = new Set<string>();

/**
 * Look up the other half of this WhatsApp identity from THIS chat.
 * Local `message_id` overlap is enough and does not wait on Evolution.
 * A slower Evolution lookup runs in the background so a busy inbox
 * can still accept the next message.
 */
async function extraKeysFromOwnChatHistory(
  config: EvoInboundConfig,
  peer: EvolutionPeer,
  providerIds: Array<string | null | undefined>,
): Promise<string[]> {
  try {
    const existing = await findContactsMatchingKeys(
      supabaseAdmin(),
      config.account_id,
      peerLookupKeys(peer),
    );
    if (!needsHistoryLink(peer, existing)) return [];

    const localItems: EvolutionHistoryItem[] = [];
    const seen = new Set<string>();
    for (const id of providerIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      localItems.push({ key: { id } });
    }
    if (localItems.length > 0) {
      const fromLocal = await findExclusiveAliasByMessageIds(
        supabaseAdmin(),
        config.account_id,
        config.id,
        peer,
        localItems,
      );
      if (fromLocal.length > 0) return fromLocal;
    }

    scheduleEvolutionIdentityLink(config, peer);
    return [];
  } catch (err) {
    console.warn('[evolution-inbound] own-chat history link failed:', err);
    return [];
  }
}

function scheduleEvolutionIdentityLink(
  config: EvoInboundConfig,
  peer: EvolutionPeer,
): void {
  if (
    !config.evolution_base_url ||
    !config.evolution_api_key ||
    !config.evolution_instance
  ) {
    return;
  }
  const flightKey = `${config.id}:${peer.contactKey}`;
  if (evolutionLinkInFlight.has(flightKey)) return;
  evolutionLinkInFlight.add(flightKey);
  void linkPeerFromEvolutionHistory(config, peer).finally(() => {
    evolutionLinkInFlight.delete(flightKey);
  });
}

async function linkPeerFromEvolutionHistory(
  config: EvoInboundConfig,
  peer: EvolutionPeer,
): Promise<void> {
  try {
    const auth = {
      baseUrl: config.evolution_base_url as string,
      apiKey: config.evolution_api_key as string,
      instance: config.evolution_instance as string,
    };

    const fromIdentity = complementaryIdentityKeys(
      peer,
      await fetchEvolutionIdentityAliases({
        ...auth,
        peer,
        timeoutMs: 2500,
      }),
    );
    let extras = fromIdentity;
    if (extras.length === 0) {
      const items: EvolutionHistoryItem[] = [];
      for (const remoteJid of remoteJidsForHistory(peer)) {
        const batch = await fetchEvolutionMessages({
          ...auth,
          remoteJid,
          limit: 30,
          timeoutMs: 4000,
        });
        items.push(...batch);
        if (items.length >= 30) break;
      }
      extras = exclusiveLinkedKeys(peer, items);
      if (extras.length === 0) {
        extras = await findExclusiveAliasByMessageIds(
          supabaseAdmin(),
          config.account_id,
          config.id,
          peer,
          items,
        );
      }
    }
    if (extras.length === 0) return;

    let lid = peer.lid;
    let username = peer.username;
    for (const extra of extras) {
      if (extra.startsWith('lid:') && !lid) lid = extra.slice(4);
      else if (extra.startsWith('user:') && !username) username = extra.slice(5);
    }

    await findOrCreateContact(
      config.account_id,
      config.user_id,
      peer.contactKey,
      '',
      {
        aliases: [...peerLookupKeys(peer), ...extras],
        lid,
        username,
        allowRename: false,
      },
    );
  } catch (err) {
    console.warn('[evolution-inbound] background identity link failed:', err);
  }
}
