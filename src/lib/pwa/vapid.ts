/**
 * VAPID key helpers for Web Push.
 *
 * Public + private keys are generated once per deployment:
 *   npx web-push generate-vapid-keys
 * and stored as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Subject is a
 * mailto: or https: contact the push services can reach — defaults to
 * NEXT_PUBLIC_SITE_URL when VAPID_SUBJECT is unset.
 *
 * When keys are missing, push is a no-op: the inbox still works, the
 * Settings → Mobile panel tells the operator to set the env vars.
 */

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!publicKey || !privateKey) return null;

  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "mailto:admin@localhost";

  return { publicKey, privateKey, subject };
}

export function isVapidConfigured(): boolean {
  return getVapidConfig() !== null;
}
