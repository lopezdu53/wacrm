import { requireApiKey } from "@/lib/auth/api-context";
import {
  fail,
  ok,
  okList,
  toApiErrorResponse,
} from "@/lib/api/v1/respond";
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from "@/lib/api/v1/pagination";
import { PRODUCT_SELECT, parseUpsertProduct, serializeProduct } from "@/lib/api/v1/products";
import { upsertProductFromOdoo } from "@/lib/api/v1/product-upsert";
import { PRODUCT_MEDIA_BUCKET } from "@/lib/inbox/product-library";

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, "products:read");
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const updatedSince = url.searchParams.get("updated_since");

    let query = ctx.supabase
      .from("product_library")
      .select(PRODUCT_SELECT)
      .eq("account_id", ctx.accountId);

    if (updatedSince) {
      const ts = new Date(updatedSince);
      if (Number.isNaN(ts.getTime())) {
        return fail(
          "bad_request",
          "'updated_since' must be an ISO-8601 timestamp",
          400,
        );
      }
      query = query.gte("updated_at", ts.toISOString());
    }

    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error("[api/v1/products] list error:", error);
      return fail("internal", "Failed to list products", 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit,
    );
    return okList(
      items.map((r) => serializeProduct(r as Record<string, unknown>)),
      nextCursor,
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireApiKey(request, "products:write");
    const odooId = new URL(request.url).searchParams.get("odoo_id")?.trim();
    if (!odooId) {
      return fail("bad_request", "odoo_id query is required", 400);
    }
    const { data, error } = await ctx.supabase
      .from("product_library")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("odoo_id", odooId)
      .maybeSingle();
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

export async function PUT(request: Request) {
  try {
    const ctx = await requireApiKey(request, "products:write");
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      return fail(
        "bad_request",
        "JSON body is required. Files over 2 MB (a 50 MB video is ~68 MB as JSON) must be uploaded with POST /api/v1/products/assets as multipart, not as content_base64.",
        400,
      );
    }
    const parsed = parseUpsertProduct(body);
    if (typeof parsed === "string") {
      return fail("bad_request", parsed, 400);
    }
    const product = await upsertProductFromOdoo(
      ctx.supabase,
      ctx.accountId,
      parsed,
    );
    return ok(product);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
