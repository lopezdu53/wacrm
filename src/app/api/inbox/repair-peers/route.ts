import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { repairComplementaryNameSplits } from "@/lib/contacts/merge-peer";

/**
 * POST /api/inbox/repair-peers
 *
 * Join complementary LID + phone contacts that share one unique
 * display name (e.g. two "Sebastian" rows). Does not touch names
 * that belong to more than one pair.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return NextResponse.json(
      { error: "Your profile is not linked to an account." },
      { status: 403 },
    );
  }

  const merged = await repairComplementaryNameSplits(
    supabaseAdmin(),
    accountId,
  );
  return NextResponse.json({ merged });
}
