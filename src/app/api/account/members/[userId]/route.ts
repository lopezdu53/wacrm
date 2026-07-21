// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migration 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import {
  createClient as createAdminClient,
  type PostgrestError,
} from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; restrict_to_assigned?: unknown }
      | null;

    const hasRole = body != null && "role" in body;
    const hasRestrict =
      body != null && "restrict_to_assigned" in body;

    if (!hasRole && !hasRestrict) {
      return NextResponse.json(
        { error: "Provide 'role' and/or 'restrict_to_assigned'" },
        { status: 400 },
      );
    }

    // --- "Restrict data visibility to only assigned data" -----------
    // A per-member visibility flag on profiles (migration 042). Only
    // meaningful for agent/viewer members; the RLS function ignores it
    // for owners/admins, and we block toggling it on the owner here so
    // the intent stays clear. Writes go through the service role because
    // profiles_update RLS only lets a user edit their OWN row.
    if (hasRestrict) {
      const restrict = body?.restrict_to_assigned;
      if (typeof restrict !== "boolean") {
        return NextResponse.json(
          { error: "'restrict_to_assigned' must be a boolean" },
          { status: 400 },
        );
      }

      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );

      // Target must belong to the caller's account, and must not be the
      // owner. Scoping the UPDATE by account_id is the real guard — the
      // service role bypasses RLS.
      const { data: target, error: targetErr } = await admin
        .from("profiles")
        .select("user_id, account_role")
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();

      if (targetErr) {
        console.error("[members route] restrict lookup error:", targetErr);
        return NextResponse.json(
          { error: "Failed to update member" },
          { status: 500 },
        );
      }
      if (!target) {
        return NextResponse.json(
          { error: "Member not found in your account" },
          { status: 404 },
        );
      }
      if (target.account_role === "owner") {
        return NextResponse.json(
          { error: "The owner always sees all data and can't be restricted" },
          { status: 400 },
        );
      }

      const { error: updateErr } = await admin
        .from("profiles")
        .update({ restrict_to_assigned: restrict })
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId);

      if (updateErr) {
        console.error("[members route] restrict update error:", updateErr);
        return NextResponse.json(
          { error: "Failed to update member" },
          { status: 500 },
        );
      }

      if (!hasRole) return NextResponse.json({ ok: true });
    }

    // --- Role change (existing behaviour) ---------------------------
    if (hasRole) {
      const role = body?.role;

      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });

      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
