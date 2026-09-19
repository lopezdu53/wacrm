import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { PRODUCT_SELECT, serializeProduct } from "@/lib/api/v1/products";

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from("product_library")
      .select(PRODUCT_SELECT)
      .eq("account_id", accountId)
      .eq("active", true)
      .order("name");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      products: (data ?? []).map((row) =>
        serializeProduct(row as Record<string, unknown>),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
