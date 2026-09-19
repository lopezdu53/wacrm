import webpush from "web-push";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { shouldDropPushSubscription } from "./recipients";
import { resolveVapidConfig } from "./vapid-store";

interface PushRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidApplied = false;

async function applyVapid(): Promise<boolean> {
  const cfg = await resolveVapidConfig();
  if (!cfg) return false;
  if (!vapidApplied) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidApplied = true;
  }
  return true;
}

export async function sendWebPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; url: string; tag: string },
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  if (!(await applyVapid())) return;

  const db = supabaseAdmin();
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", unique);

  const body = JSON.stringify(payload);
  await Promise.all(((subs ?? []) as PushRow[]).map((sub) => sendOne(sub, body)));
}

async function sendOne(sub: PushRow, payload: string): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payload,
      { TTL: 60 * 60 * 12, urgency: "high" },
    );
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (shouldDropPushSubscription(status)) {
      await supabaseAdmin().from("push_subscriptions").delete().eq("id", sub.id);
      return;
    }
    console.warn("[pwa] push send failed:", status ?? err);
  }
}
