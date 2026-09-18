import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  parsePushSubscriptionBody,
  isPushEndpointUrl,
} from "@/lib/pwa/subscription";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`push-sub:${ctx.userId}`, RATE_LIMITS.pushSubscribe);
  if (!limit.success) return rateLimitResponse(limit);

  const body = await request.json().catch(() => null);
  const parsed = parsePushSubscriptionBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin().from("push_subscriptions").upsert(
    {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      user_agent: userAgent,
      updated_at: now,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("[push/subscribe] upsert failed:", error);
    return NextResponse.json({ error: "Could not save subscription" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await requireRole("viewer");
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const endpoint =
    body && typeof body === "object" && typeof (body as { endpoint?: unknown }).endpoint === "string"
      ? (body as { endpoint: string }).endpoint.trim()
      : "";
  if (!isPushEndpointUrl(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", ctx.userId);

  if (error) {
    return NextResponse.json({ error: "Could not remove subscription" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
