import { isIP } from "node:net";

import { isPrivateOrReservedIp } from "@/lib/webhooks/ssrf";

const MAX_ENDPOINT_LEN = 2048;
const MAX_KEY_LEN = 512;

/**
 * A Web Push endpoint must be https and must not point at a loopback /
 * private host. The browser (FCM, Mozilla Autopush, Apple web push)
 * chooses the URL; we only store it and later POST a payload to it.
 */
export function isPushEndpointUrl(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_ENDPOINT_LEN) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return false;
  }
  if (isIP(host) && isPrivateOrReservedIp(host)) return false;
  return true;
}

export function isPushKey(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0 && raw.length <= MAX_KEY_LEN;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function parsePushSubscriptionBody(
  body: unknown,
): PushSubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const keys =
    rec.keys && typeof rec.keys === "object"
      ? (rec.keys as Record<string, unknown>)
      : rec;
  const endpoint = typeof rec.endpoint === "string" ? rec.endpoint.trim() : "";
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  if (!isPushEndpointUrl(endpoint) || !isPushKey(p256dh) || !isPushKey(auth)) {
    return null;
  }
  return { endpoint, p256dh, auth };
}
