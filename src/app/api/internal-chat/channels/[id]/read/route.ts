// ============================================================
// POST /api/internal-chat/channels/[id]/read
//
// Mark the channel read for the caller — set last_read_at = now on
// their member row. Clears the unread badge.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id: channelId } = await params;

    const db = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { error } = await db
      .from("internal_channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("user_id", ctx.userId);
    if (error) {
      console.error("[internal-chat] mark read error:", error);
      return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
