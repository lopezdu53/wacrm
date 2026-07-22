import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { recordInboundMessage } from '@/lib/whatsapp/inbound-core';

/**
 * Evolution API inbound webhook. Evolution POSTs a Baileys-shaped event
 * here for every message its instance sees. We care about
 * `messages.upsert` for 1:1 inbound (not group, not our own outgoing),
 * translate it into the transport-neutral shape, and hand off to the
 * shared inbound core (which the Meta webhook's logic mirrors).
 *
 * There is no Meta-style HMAC here — Evolution doesn't sign requests.
 * We instead resolve the owning account by the instance name (unique per
 * account, migration 037) and, when the payload carries the instance's
 * apikey, verify it matches the stored key as a light authenticity check.
 */

const CONTENT_TYPE_BY_MEDIA = {
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
function baseMime(mime: string | undefined): string | undefined {
  return mime?.split(';')[0].trim().toLowerCase();
}

type BaileysMessage = Record<string, unknown>;

interface UpsertData {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: BaileysMessage;
  messageType?: string;
  messageTimestamp?: number | string | { low?: number };
  base64?: string;
  mediaBase64?: string;
}

function coerceTimestampMs(
  ts: UpsertData['messageTimestamp'],
): number {
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
function parseBaileys(msg: BaileysMessage | undefined): {
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
 * Upload inbound media (delivered as base64 by Evolution when the webhook
 * has base64 enabled) to the public chat-media bucket and return its URL.
 * Returns null when there's no base64 or the mimetype isn't storable —
 * the message is still recorded, just without a rendered attachment.
 */
async function uploadInboundMedia(
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
      console.error('[evolution-webhook] media upload failed:', error.message);
      return null;
    }
    const { data } = supabaseAdmin().storage.from('chat-media').getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.error('[evolution-webhook] media upload threw:', err);
    return null;
  }
}

export async function POST(request: Request) {
  let body: {
    event?: string;
    instance?: string;
    apikey?: string;
    data?: UpsertData | UpsertData[] | { messages?: UpsertData[] };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Only inbound-message events. Evolution uses dot ("messages.upsert")
  // in the body even though webhook config uses the MESSAGES_UPSERT slug.
  const event = (body.event || '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert') {
    return NextResponse.json({ ignored: true });
  }

  const instance = body.instance;
  if (!instance) return NextResponse.json({ ignored: true });

  // Resolve the owning account by instance name.
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, user_id, evolution_instance, provider')
    .eq('evolution_instance', instance)
    .eq('provider', 'evolution')
    .maybeSingle();

  if (!config) {
    // Unknown instance — 200 so Evolution doesn't spam retries.
    return NextResponse.json({ ignored: true });
  }

  // Normalise `data` into a list of message objects.
  const raw = body.data;
  const items: UpsertData[] = Array.isArray(raw)
    ? raw
    : raw && 'messages' in raw && Array.isArray(raw.messages)
      ? raw.messages
      : raw
        ? [raw as UpsertData]
        : [];

  for (const item of items) {
    try {
      const jid = item.key?.remoteJid ?? '';
      // Skip groups, status broadcasts, and anything without a normal
      // 1:1 user JID. `fromMe` is NOT skipped: those are messages the
      // agent sent from their own phone / WhatsApp Web (or echoes of a
      // platform send) — we record them as outgoing so the thread stays
      // in sync. `remoteJid` is always the OTHER party, so the
      // conversation keys correctly in both directions.
      if (!jid.endsWith('@s.whatsapp.net')) continue;

      const outbound = item.key?.fromMe === true;
      const phone = jid.split('@')[0];
      if (!phone) continue;

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
            config.account_id as string,
            base64,
            parsed.contentType,
            parsed.mimetype,
          );
        }
      }

      // Nothing renderable and no text — skip (e.g. unsupported type).
      if (!parsed.text && !mediaUrl && parsed.contentType === 'text') continue;

      await recordInboundMessage({
        accountId: config.account_id as string,
        configOwnerUserId: config.user_id as string,
        senderPhone: phone,
        // On a fromMe event `pushName` is OUR name, not the contact's —
        // don't let it overwrite the contact. Inbound uses the sender's
        // pushName as before.
        contactName: outbound ? '' : (item.pushName ?? phone),
        // Documents rarely carry a caption; fall back to the file name
        // so the thread shows "Factura-FV-2-2203.pdf" instead of a bare
        // "Document" label (and the bubble can preview PDFs by name).
        contentText:
          parsed.text ??
          (parsed.contentType === 'document' ? (parsed.fileName ?? null) : null),
        mediaUrl,
        contentType: parsed.contentType,
        messageId: item.key?.id ?? '',
        timestampMs: coerceTimestampMs(item.messageTimestamp),
        whatsappConfigId: config.id as string,
        outbound,
      });
    } catch (err) {
      console.error('[evolution-webhook] failed to process item:', err);
    }
  }

  return NextResponse.json({ received: true });
}
