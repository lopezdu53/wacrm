/**
 * Evolution API client — the second WhatsApp transport (see migration
 * 037). Evolution is an unofficial WhatsApp-Web/Baileys gateway: you run
 * your own server, create an "instance", and connect it by scanning a QR
 * code from a phone. Unlike the Meta Cloud API there are no templates and
 * no 24-hour window — you send free-form messages once the instance is
 * connected.
 *
 * Every function takes a single named-params object (same convention as
 * `meta-api.ts`) so a swapped argument is a TypeScript error, not a
 * runtime failure. All calls authenticate with the `apikey` header.
 *
 * Targets Evolution API v2 (the current line). v1 used slightly different
 * request bodies (e.g. `textMessage: { text }`); if you run v1, the send
 * bodies here need adjusting.
 */

export interface EvolutionAuth {
  /** Base URL of the Evolution server, no trailing slash (validated). */
  baseUrl: string;
  /** Global (or instance) API key sent as the `apikey` header. */
  apiKey: string;
  /** Instance name this call targets. */
  instance: string;
}

export interface EvolutionSendResult {
  /** The WhatsApp message id Evolution returns (key.id), when present. */
  messageId: string;
}

export type EvolutionConnectionState =
  | 'open' // connected & ready
  | 'connecting' // waiting for the QR scan / reconnecting
  | 'close' // disconnected
  | 'unknown';

/** Strip a trailing slash so `${baseUrl}/path` never double-slashes. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

async function throwEvolutionError(
  response: Response,
  fallback: string,
): Promise<never> {
  let message = fallback;
  try {
    const data = (await response.json()) as {
      message?: string | string[];
      error?: string;
      response?: { message?: string | string[] };
    };
    const raw =
      data.response?.message ?? data.message ?? data.error ?? fallback;
    message = Array.isArray(raw) ? raw.join('; ') : String(raw);
  } catch {
    // Body wasn't JSON — keep the fallback.
  }
  throw new Error(message);
}

// ============================================================
// Instance lifecycle (connect via QR)
// ============================================================

export interface EvolutionQr {
  /** Base64-encoded PNG data URL of the QR, when the instance needs a scan. */
  base64: string | null;
  /** Pairing code alternative to the QR, when Evolution returns one. */
  pairingCode: string | null;
  state: EvolutionConnectionState;
}

/**
 * Create the instance if it doesn't exist yet. Evolution returns 403 (or
 * a "already in use" message) when the name is taken — we treat that as
 * success and let the caller fetch the QR / state separately, so this is
 * safe to call on every "connect" click.
 */
export async function createEvolutionInstance({
  baseUrl,
  apiKey,
  instance,
  webhookUrl,
}: EvolutionAuth & { webhookUrl?: string }): Promise<void> {
  const url = `${normalizeBaseUrl(baseUrl)}/instance/create`;
  const body: Record<string, unknown> = {
    instanceName: instance,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  };
  // v2 accepts the webhook inline at creation time.
  if (webhookUrl) {
    body.webhook = {
      url: webhookUrl,
      byEvents: false,
      base64: true,
      events: ['MESSAGES_UPSERT'],
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (response.ok) return;

  // Already exists → not an error for our idempotent connect flow.
  if (response.status === 403 || response.status === 409) return;
  const text = await response.clone().text();
  if (/already in use|already exists/i.test(text)) return;

  await throwEvolutionError(response, `Failed to create instance (${response.status})`);
}

/**
 * Point an existing instance's webhook at our inbound route. Separate
 * from create so we can (re)wire the webhook even for instances that
 * already existed before this app was connected.
 */
export async function setEvolutionWebhook({
  baseUrl,
  apiKey,
  instance,
  webhookUrl,
}: EvolutionAuth & { webhookUrl: string }): Promise<void> {
  const url = `${normalizeBaseUrl(baseUrl)}/webhook/set/${encodeURIComponent(instance)}`;
  const body = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: false,
      base64: true,
      events: ['MESSAGES_UPSERT'],
    },
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwEvolutionError(
      response,
      `Failed to set webhook (${response.status})`,
    );
  }
}

/** Map Evolution's raw state strings onto our narrow union. */
function normalizeState(raw: unknown): EvolutionConnectionState {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'open') return 'open';
  if (s === 'connecting') return 'connecting';
  if (s === 'close' || s === 'closed') return 'close';
  return 'unknown';
}

/**
 * Fetch the current connection state. `open` means the phone is linked
 * and ready to send/receive.
 */
export async function getEvolutionState({
  baseUrl,
  apiKey,
  instance,
}: EvolutionAuth): Promise<EvolutionConnectionState> {
  const url = `${normalizeBaseUrl(baseUrl)}/instance/connectionState/${encodeURIComponent(instance)}`;
  const response = await fetch(url, { headers: authHeaders(apiKey) });
  if (!response.ok) {
    if (response.status === 404) return 'close';
    await throwEvolutionError(
      response,
      `Failed to read connection state (${response.status})`,
    );
  }
  const data = (await response.json()) as {
    instance?: { state?: string };
    state?: string;
  };
  return normalizeState(data.instance?.state ?? data.state);
}

/**
 * Ask the instance to (re)connect and return a fresh QR to scan. When
 * the instance is already `open`, Evolution returns no QR — we surface
 * that as `state: 'open'` with a null image so the UI can show "connected".
 */
export async function getEvolutionQr({
  baseUrl,
  apiKey,
  instance,
}: EvolutionAuth): Promise<EvolutionQr> {
  const url = `${normalizeBaseUrl(baseUrl)}/instance/connect/${encodeURIComponent(instance)}`;
  const response = await fetch(url, { headers: authHeaders(apiKey) });
  if (!response.ok) {
    await throwEvolutionError(
      response,
      `Failed to fetch QR (${response.status})`,
    );
  }
  const data = (await response.json()) as {
    base64?: string;
    code?: string;
    pairingCode?: string;
    instance?: { state?: string };
    state?: string;
  };

  const rawBase64 = data.base64 ?? null;
  // Evolution sometimes returns the bare base64, sometimes a full data
  // URL. Normalise to a data URL the <img> tag can render directly.
  const base64 =
    rawBase64 && !rawBase64.startsWith('data:')
      ? `data:image/png;base64,${rawBase64}`
      : rawBase64;

  return {
    base64,
    pairingCode: data.pairingCode ?? data.code ?? null,
    state: base64 ? 'connecting' : normalizeState(data.instance?.state ?? data.state),
  };
}

/**
 * Delete/log out an instance. Best-effort — used when an account resets
 * its Evolution connection. Never throws; a failed logout is a nit.
 */
export async function logoutEvolutionInstance({
  baseUrl,
  apiKey,
  instance,
}: EvolutionAuth): Promise<void> {
  try {
    await fetch(
      `${normalizeBaseUrl(baseUrl)}/instance/logout/${encodeURIComponent(instance)}`,
      { method: 'DELETE', headers: authHeaders(apiKey) },
    );
  } catch {
    // best-effort
  }
}

// ============================================================
// Sending
// ============================================================

/** Evolution accepts the bare national+country number (no leading +). */
export function toEvolutionNumber(e164OrDigits: string): string {
  return e164OrDigits.replace(/[^\d]/g, '');
}

function extractMessageId(data: unknown): string {
  const d = data as { key?: { id?: string }; id?: string } | null;
  return d?.key?.id ?? d?.id ?? '';
}

export async function sendEvolutionText({
  baseUrl,
  apiKey,
  instance,
  to,
  text,
}: EvolutionAuth & { to: string; text: string }): Promise<EvolutionSendResult> {
  const url = `${normalizeBaseUrl(baseUrl)}/message/sendText/${encodeURIComponent(instance)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ number: toEvolutionNumber(to), text }),
  });
  if (!response.ok) {
    await throwEvolutionError(response, `Failed to send text (${response.status})`);
  }
  return { messageId: extractMessageId(await response.json()) };
}

/** Evolution media type. 'audio' is sent through a dedicated endpoint. */
export type EvolutionMediaType = 'image' | 'video' | 'document' | 'audio';

export async function sendEvolutionMedia({
  baseUrl,
  apiKey,
  instance,
  to,
  mediaType,
  mediaUrl,
  caption,
  fileName,
}: EvolutionAuth & {
  to: string;
  mediaType: EvolutionMediaType;
  /** Public URL (or base64) of the media. */
  mediaUrl: string;
  caption?: string;
  fileName?: string;
}): Promise<EvolutionSendResult> {
  const base = normalizeBaseUrl(baseUrl);
  const number = toEvolutionNumber(to);

  // Voice notes go through the narrowcast/whatsapp-audio endpoint; other
  // media use sendMedia.
  if (mediaType === 'audio') {
    const response = await fetch(
      `${base}/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`,
      {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({ number, audio: mediaUrl }),
      },
    );
    if (!response.ok) {
      await throwEvolutionError(response, `Failed to send audio (${response.status})`);
    }
    return { messageId: extractMessageId(await response.json()) };
  }

  const response = await fetch(
    `${base}/message/sendMedia/${encodeURIComponent(instance)}`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        number,
        mediatype: mediaType,
        media: mediaUrl,
        caption: caption || undefined,
        fileName: fileName || undefined,
      }),
    },
  );
  if (!response.ok) {
    await throwEvolutionError(response, `Failed to send media (${response.status})`);
  }
  return { messageId: extractMessageId(await response.json()) };
}

// ============================================================
// History backfill (used by the on-demand "sync" that recovers
// messages the live webhook may have missed).
// ============================================================

/** A message record as returned by Evolution's findMessages. */
export interface EvolutionHistoryItem {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number | string;
}

/**
 * Fetch recent messages for one chat (remoteJid) from Evolution.
 * Different Evolution builds shape the response differently — an array,
 * `{ messages: [...] }`, or `{ messages: { records: [...] } }` — so we
 * normalise all three to a flat list. Best-effort: returns [] on any
 * failure rather than throwing, so the sync degrades gracefully.
 */
export async function fetchEvolutionMessages({
  baseUrl,
  apiKey,
  instance,
  remoteJid,
  limit = 50,
}: EvolutionAuth & { remoteJid: string; limit?: number }): Promise<
  EvolutionHistoryItem[]
> {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/findMessages/${encodeURIComponent(instance)}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ where: { key: { remoteJid } }, limit, page: 1 }),
    });
    if (!response.ok) return [];
    const json: unknown = await response.json();

    const asItems = (v: unknown): EvolutionHistoryItem[] =>
      Array.isArray(v) ? (v as EvolutionHistoryItem[]) : [];

    if (Array.isArray(json)) return json as EvolutionHistoryItem[];
    const messages = (json as { messages?: unknown })?.messages;
    if (Array.isArray(messages)) return asItems(messages);
    const records = (messages as { records?: unknown })?.records;
    if (Array.isArray(records)) return asItems(records);
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetch the base64 payload for one media message. Media isn't included
 * in findMessages, so the sync pulls it per message to make audios /
 * images / PDFs playable. Returns null on any failure.
 */
export async function fetchEvolutionMediaBase64({
  baseUrl,
  apiKey,
  instance,
  item,
}: EvolutionAuth & { item: EvolutionHistoryItem }): Promise<string | null> {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        message: { key: item.key, message: item.message },
        convertToMp4: false,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { base64?: string } | null;
    return json?.base64 ?? null;
  } catch {
    return null;
  }
}
