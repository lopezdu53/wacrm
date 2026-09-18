import webpush from "web-push";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getVapidConfig } from "./vapid";
import {
  previewInboundBody,
  resolveNewMessageRecipients,
  shouldDropPushSubscription,
  type NewMessageMember,
} from "./recipients";

export interface NotifyNewInboundArgs {
  accountId: string;
  conversationId: string;
  contactId: string;
  contactName: string;
  contentText?: string | null;
  contentType: string;
  assignedAgentId?: string | null;
}

interface PushRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidApplied = false;

function applyVapid(): boolean {
  const cfg = getVapidConfig();
  if (!cfg) return false;
  if (!vapidApplied) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    vapidApplied = true;
  }
  return true;
}

/**
 * In-app notification + Web Push for a newly persisted customer
 * WhatsApp message. Failures never throw — inbound must still land.
 */
export async function notifyNewInboundMessage(
  args: NotifyNewInboundArgs,
): Promise<void> {
  try {
    const db = supabaseAdmin();
    const [{ data: followers }, { data: members }] = await Promise.all([
      db
        .from("conversation_followers")
        .select("user_id")
        .eq("conversation_id", args.conversationId),
      db
        .from("profiles")
        .select("user_id, account_role, restrict_to_assigned")
        .eq("account_id", args.accountId),
    ]);

    const recipientIds = resolveNewMessageRecipients({
      assignedAgentId: args.assignedAgentId ?? null,
      followerIds: (followers ?? []).map((row) => row.user_id as string),
      members: (members ?? []) as NewMessageMember[],
    });
    if (recipientIds.length === 0) return;

    const title = args.contactName.trim() || "WhatsApp";
    const body = previewInboundBody(args.contentText, args.contentType);

    await Promise.all(
      recipientIds.map((userId) =>
        upsertInAppNotification({
          accountId: args.accountId,
          userId,
          conversationId: args.conversationId,
          contactId: args.contactId,
          title,
          body,
        }),
      ),
    );

    if (!applyVapid()) return;

    const { data: subs } = await db
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", recipientIds);

    const url = `/inbox?c=${encodeURIComponent(args.conversationId)}`;
    const payload = JSON.stringify({
      title,
      body,
      url,
      tag: `conv:${args.conversationId}`,
    });

    await Promise.all(
      ((subs ?? []) as PushRow[]).map((sub) => sendOne(sub, payload)),
    );
  } catch (err) {
    console.error("[pwa] notifyNewInboundMessage failed:", err);
  }
}

async function upsertInAppNotification(args: {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  title: string;
  body: string;
}): Promise<void> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("notifications")
    .select("id")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("type", "new_message")
    .is("read_at", null)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await db
      .from("notifications")
      .update({
        title: args.title,
        body: args.body,
        contact_id: args.contactId,
      })
      .eq("id", existing.id);
    return;
  }

  await db.from("notifications").insert({
    account_id: args.accountId,
    user_id: args.userId,
    type: "new_message",
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    title: args.title,
    body: args.body,
  });
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
