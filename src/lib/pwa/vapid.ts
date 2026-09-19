/**
 * VAPID key helpers for Web Push.
 *
 * Env vars win when set. Otherwise `resolveVapidConfig` (vapid-store)
 * loads or creates a singleton pair in `push_vapid` (migration 052).
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidSubject(): string {
  return (
    process.env.VAPID_SUBJECT?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "mailto:admin@localhost"
  );
}

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: vapidSubject() };
}

export function isVapidConfigured(): boolean {
  return getVapidConfig() !== null;
}
