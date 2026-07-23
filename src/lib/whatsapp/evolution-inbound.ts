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
import { recordInboundMessage } from '@/lib/whatsapp/inbound-core';
import { vcardsToText } from '@/lib/whatsapp/vcard';

export const CONTENT_TYPE_BY_MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
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
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: BaileysMessage;
  messageType?: string;
  messageTimestamp?: number | string | { low?: number };
  base64?: string;
  mediaBase64?: string;
}

/** The bits of a whatsapp_config row the inbound pipeline needs. */
export interface EvoInboundConfig {
  id: string;
  account_id: string;
  user_id: string;
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

/** Pull text + media descriptor out of a Baileys message object. */
export function parseBaileys(msg: BaileysMessage | undefined): {
  contentType: string;
  text: string | null;
  mediaKey: keyof typeof CONTENT_TYPE_BY_MEDIA | null;
  mimetype: string | undefined;
  fileName: string | undefined;
} {
  if (!msg) {
    return { contentType: 'text', text: null, mediaKey: null, mimetype: undefined, fileName: undefined };
  }

  if (typeof msg.conversation === 'string') {
    return { contentType: 'text', text: msg.conversation, mediaKey: null, mimetype: undefined, fileName: undefined };
  }
  const ext = msg.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) {
    return { contentType: 'text', text: ext.text, mediaKey: null, mimetype: undefined, fileName: undefined };
  }

  // Shared contact card(s) — flatten to a labelled text line.
  const contactMsg = msg.contactMessage as
    | { displayName?: string; vcard?: string }
    | undefined;
  if (contactMsg?.vcard || contactMsg?.displayName) {
    return { contentType: 'text', text: vcardsToText([contactMsg]), mediaKey: null, mimetype: undefined, fileName: undefined };
  }
  const contactsArr = msg.contactsArrayMessage as
    | { contacts?: { displayName?: string; vcard?: string }[] }
    | undefined;
  if (contactsArr?.contacts?.length) {
    return { contentType: 'text', text: vcardsToText(contactsArr.contacts), mediaKey: null, mimetype: undefined, fileName: undefined };
  }

  // Documents can arrive wrapped in documentWithCaptionMessage.
  const wrapped = (msg.documentWithCaptionMessage as { message?: BaileysMessage } | undefined)?.message;
  const source = wrapped ?? msg;

  for (const key of Object.keys(CONTENT_TYPE_BY_MEDIA) as (keyof typeof CONTENT_TYPE_BY_MEDIA)[]) {
    const media = source[key] as
      | { caption?: string; mimetype?: string; fileName?: string }
      | undefined;
    if (media) {
      return {
        contentType: CONTENT_TYPE_BY_MEDIA[key],
        text: media.caption ?? null,
        mediaKey: key,
        mimetype: baseMime(media.mimetype),
        fileName: media.fileName,
      };
    }
  }

  return { contentType: 'text', text: null, mediaKey: null, mimetype: undefined, fileName: undefined };
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
    const jid = item.key?.remoteJid ?? '';
    if (!jid.endsWith('@s.whatsapp.net')) return 'skipped';

    const outbound = item.key?.fromMe === true;
    const phone = jid.split('@')[0];
    if (!phone) return 'skipped';

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

    await recordInboundMessage({
      accountId: config.account_id,
      configOwnerUserId: config.user_id,
      senderPhone: phone,
      contactName: outbound ? '' : (item.pushName ?? phone),
      contentText:
        parsed.text ??
        (parsed.contentType === 'document' ? (parsed.fileName ?? null) : null),
      mediaUrl,
      contentType: parsed.contentType,
      messageId: item.key?.id ?? '',
      timestampMs: coerceTimestampMs(item.messageTimestamp),
      whatsappConfigId: config.id,
      outbound,
    });
    return 'recorded';
  } catch (err) {
    console.error('[evolution-inbound] failed to process item:', err);
    return 'error';
  }
}
