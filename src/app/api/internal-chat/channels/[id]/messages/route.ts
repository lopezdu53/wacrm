// ============================================================
// POST /api/internal-chat/channels/[id]/messages
//
// Post a message to an internal channel. Verifies the caller is a
// member (the trust boundary), inserts the message, bumps the
// channel's last_message_at, and marks the sender caught up.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

const MAX_LEN = 4000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id: channelId } = await params;

    const body = (await request.json().catch(() => null)) as {
      content?: unknown;
    } | null;
    const content =
      typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (content.length > MAX_LEN) {
      return NextResponse.json(
        { error: `content must be ${MAX_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const db = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Membership check — the caller must belong to this channel, and it
    // must be in their account.
    const { data: membership } = await db
      .from("internal_channel_members")
      .select("id, internal_channels!inner(account_id)")
      .eq("channel_id", channelId)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const channelAccount = (
      membership?.internal_channels as { account_id?: string } | null
    )?.account_id;
    if (!membership || channelAccount !== ctx.accountId) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insErr } = await db
      .from("internal_messages")
      .insert({ channel_id: channelId, sender_id: ctx.userId, content })
      .select("id, channel_id, sender_id, content, created_at")
      .single();
    if (insErr || !inserted) {
      console.error("[internal-chat] send error:", insErr);
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    }

    // Bump channel activity + keep the sender caught up.
    await Promise.all([
      db
        .from("internal_channels")
        .update({ last_message_at: now })
        .eq("id", channelId),
      db
        .from("internal_channel_members")
        .update({ last_read_at: now })
        .eq("channel_id", channelId)
        .eq("user_id", ctx.userId),
    ]);

    return NextResponse.json({ message: inserted });
  } catch (err) {
    return toErrorResponse(err);
  }
}
