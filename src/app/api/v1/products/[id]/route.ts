import { requireApiKey } from "@/lib/auth/api-context";
import { fail, ok, toApiErrorResponse } from "@/lib/api/v1/respond";
import { PRODUCT_SELECT, serializeProduct } from "@/lib/api/v1/products";
import { PRODUCT_MEDIA_BUCKET } from "@/lib/inbox/product-library";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, "products:read");
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from("product_library")
      .select(PRODUCT_SELECT)
      .eq("account_id", ctx.accountId)
      .eq("id", id)
      .maybeSingle();
    if (error) return fail("internal", "Failed to load product", 500);
    if (!data) return fail("not_found", "Product not found", 404);
    return ok(serializeProduct(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, "products:write");
    const url = new URL(request.url);
    const odooId = url.searchParams.get("odoo_id");
    const { id } = await params;

    let query = ctx.supabase
      .from("product_library")
      .select("id")
      .eq("account_id", ctx.accountId);
    query = odooId ? query.eq("odoo_id", odooId) : query.eq("id", id);
    const { data, error } = await query.maybeSingle();
    if (error) return fail("internal", "Failed to find product", 500);
    if (!data) return fail("not_found", "Product not found", 404);

    const { data: assets } = await ctx.supabase
      .from("product_assets")
      .select("storage_path")
      .eq("product_id", data.id);
    const paths = (assets ?? [])
      .map((a) => a.storage_path as string | null)
      .filter((p): p is string => Boolean(p));
    if (paths.length) {
      await ctx.supabase.storage.from(PRODUCT_MEDIA_BUCKET).remove(paths);
    }
    const { error: delErr } = await ctx.supabase
      .from("product_library")
      .delete()
      .eq("id", data.id);
    if (delErr) return fail("internal", "Failed to delete product", 500);
    return ok({ id: data.id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
