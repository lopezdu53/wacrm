// ============================================================
// /api/internal-chat/channels
//
//   GET  — list the caller's channels (DMs + groups) with members,
//          last message, and unread count.
//   POST — create a DM or group. DMs are deduped: creating one that
//          already exists returns the existing channel.
//
// Reads/writes use the service role AFTER resolving the caller's own
// membership, which is the trust boundary — the caller only ever sees
// or writes channels they belong to, scoped to their account.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const db = admin();

    const { data: memberships } = await db
      .from("internal_channel_members")
      .select("channel_id, last_read_at")
      .eq("user_id", ctx.userId);

    const channelIds = (memberships ?? []).map((m) => m.channel_id as string);
    if (channelIds.length === 0) return NextResponse.json({ channels: [] });

    const lastReadByChannel = new Map<string, string>();
    (memberships ?? []).forEach((m) =>
      lastReadByChannel.set(m.channel_id as string, m.last_read_at as string),
    );

    const [{ data: channels }, { data: memberRows }, { data: profiles }] =
      await Promise.all([
        db
          .from("internal_channels")
          .select("id, kind, name, created_by, last_message_at, created_at")
          .in("id", channelIds)
          .eq("account_id", ctx.accountId),
        db
          .from("internal_channel_members")
          .select("channel_id, user_id")
          .in("channel_id", channelIds),
        db
          .from("profiles")
          .select("user_id, full_name, avatar_url")
          .eq("account_id", ctx.accountId),
      ]);

    const profileById = new Map(
      (profiles ?? []).map((p) => [
        p.user_id as string,
        {
          user_id: p.user_id as string,
          full_name: (p.full_name as string | null) ?? "",
          avatar_url: (p.avatar_url as string | null) ?? null,
        },
      ]),
    );

    const membersByChannel = new Map<string, string[]>();
    (memberRows ?? []).forEach((r) => {
      const cid = r.channel_id as string;
      if (!membersByChannel.has(cid)) membersByChannel.set(cid, []);
      membersByChannel.get(cid)!.push(r.user_id as string);
    });

    // Per-channel last message + unread count (small teams → cheap).
    const enriched = await Promise.all(
      (channels ?? []).map(async (c) => {
        const cid = c.id as string;
        const lastRead = lastReadByChannel.get(cid) ?? new Date(0).toISOString();

        const [{ data: last }, { count }] = await Promise.all([
          db
            .from("internal_messages")
            .select("content, created_at, sender_id")
            .eq("channel_id", cid)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          db
            .from("internal_messages")
            .select("id", { count: "exact", head: true })
            .eq("channel_id", cid)
            .gt("created_at", lastRead)
            .neq("sender_id", ctx.userId),
        ]);

        return {
          id: cid,
          kind: c.kind as "dm" | "group",
          name: (c.name as string | null) ?? null,
          created_by: (c.created_by as string | null) ?? null,
          last_message_at: (c.last_message_at as string | null) ?? null,
          members: (membersByChannel.get(cid) ?? [])
            .map((uid) => profileById.get(uid))
            .filter((p): p is NonNullable<typeof p> => p != null),
          last_message: last
            ? {
                content: last.content as string,
                created_at: last.created_at as string,
                sender_id: last.sender_id as string,
              }
            : null,
          unread_count: count ?? 0,
        };
      }),
    );

    // Newest activity first; channels with no messages fall to the end.
    enriched.sort((a, b) => {
      const at = a.last_message_at ?? "";
      const bt = b.last_message_at ?? "";
      return bt.localeCompare(at);
    });

    return NextResponse.json({ channels: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const db = admin();

    const body = (await request.json().catch(() => null)) as {
      kind?: unknown;
      memberIds?: unknown;
      name?: unknown;
    } | null;

    const kind = body?.kind;
    if (kind !== "dm" && kind !== "group") {
      return NextResponse.json(
        { error: "'kind' must be 'dm' or 'group'" },
        { status: 400 },
      );
    }

    const rawMembers = Array.isArray(body?.memberIds)
      ? (body!.memberIds as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    // Always include the caller; de-dupe.
    const memberSet = new Set<string>([ctx.userId, ...rawMembers]);

    // Every member must belong to the caller's account.
    const { data: validProfiles } = await db
      .from("profiles")
      .select("user_id")
      .eq("account_id", ctx.accountId)
      .in("user_id", [...memberSet]);
    const validIds = new Set((validProfiles ?? []).map((p) => p.user_id as string));
    const members = [...memberSet].filter((id) => validIds.has(id));

    if (kind === "dm") {
      if (members.length !== 2) {
        return NextResponse.json(
          { error: "A direct message needs exactly one other member" },
          { status: 400 },
        );
      }
      const other = members.find((id) => id !== ctx.userId)!;

      // Dedupe: a DM between these two already? Intersect their DM
      // memberships — a DM has exactly those two members.
      const [{ data: mine }, { data: theirs }] = await Promise.all([
        db.from("internal_channel_members").select("channel_id").eq("user_id", ctx.userId),
        db.from("internal_channel_members").select("channel_id").eq("user_id", other),
      ]);
      const theirSet = new Set((theirs ?? []).map((r) => r.channel_id as string));
      const shared = (mine ?? [])
        .map((r) => r.channel_id as string)
        .filter((cid) => theirSet.has(cid));
      if (shared.length > 0) {
        const { data: existing } = await db
          .from("internal_channels")
          .select("id")
          .in("id", shared)
          .eq("account_id", ctx.accountId)
          .eq("kind", "dm")
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          return NextResponse.json({ id: existing.id, created: false });
        }
      }
    } else {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "A group needs a name" },
          { status: 400 },
        );
      }
      if (members.length < 2) {
        return NextResponse.json(
          { error: "A group needs at least one other member" },
          { status: 400 },
        );
      }
    }

    const now = new Date().toISOString();
    const { data: channel, error: chErr } = await db
      .from("internal_channels")
      .insert({
        account_id: ctx.accountId,
        kind,
        name: kind === "group" ? (body?.name as string).trim() : null,
        created_by: ctx.userId,
        last_message_at: now,
      })
      .select("id")
      .single();
    if (chErr || !channel) {
      console.error("[internal-chat] create channel error:", chErr);
      return NextResponse.json({ error: "Failed to create channel" }, { status: 500 });
    }

    const { error: memErr } = await db.from("internal_channel_members").insert(
      members.map((uid) => ({
        channel_id: channel.id,
        user_id: uid,
        // Creator starts caught up; others start with it unread-worthy.
        last_read_at: uid === ctx.userId ? now : new Date(0).toISOString(),
      })),
    );
    if (memErr) {
      console.error("[internal-chat] add members error:", memErr);
      return NextResponse.json({ error: "Failed to add members" }, { status: 500 });
    }

    return NextResponse.json({ id: channel.id, created: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
