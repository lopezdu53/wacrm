// ============================================================
// /api/account
//
//   GET    — current caller's account + role. Any member.
//   PATCH  — rename the account.                  Admin+.
//   DELETE — wipe the workspace + owner login.    Owner only.
//
// Why these verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  DeleteAccountError,
  parseDeleteAccountBody,
  verifyOwnerPassword,
  wipeAccountAndUsers,
} from "@/lib/auth/delete-account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Account name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ name })
      .eq("id", ctx.accountId)
      .select("id, name")
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("owner");

    // Tighter than generic admin actions: a wrong-password loop is
    // the realistic abuse case, and a successful call is irreversible.
    const limit = checkRateLimit(
      `admin:deleteAccount:${ctx.userId}`,
      RATE_LIMITS.deleteAccount,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);

    let parsed;
    try {
      parsed = parseDeleteAccountBody(body, ctx.account.name);
    } catch (err) {
      if (err instanceof DeleteAccountError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const {
      data: { user },
    } = await ctx.supabase.auth.getUser();
    const email = user?.email;
    if (!email) {
      return NextResponse.json(
        { error: "Owner email is required to verify deletion" },
        { status: 400 },
      );
    }

    const passwordOk = await verifyOwnerPassword(email, parsed.password);
    if (!passwordOk) {
      return NextResponse.json(
        { error: "Password is incorrect" },
        { status: 403 },
      );
    }

    try {
      await wipeAccountAndUsers(supabaseAdmin(), ctx.accountId, ctx.userId);
    } catch (err) {
      if (err instanceof DeleteAccountError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
