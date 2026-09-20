import { requireApiKey } from "@/lib/auth/api-context";
import { fail, ok, toApiErrorResponse } from "@/lib/api/v1/respond";
import { isProductAssetKind } from "@/lib/inbox/product-library";
import {
  FILE_ASSET_KINDS,
  PRODUCT_FILE_MAX_BYTES,
  attachProductAssetFromOdoo,
} from "@/lib/api/v1/product-upsert";

export const maxDuration = 180;

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, "products:write");
    const form = await request.formData().catch(() => null);
    if (!form) {
      return fail("bad_request", "multipart form body is required", 400);
    }

    const odooProductId = formText(form, "odoo_id");
    const kind = formText(form, "kind");
    const name = formText(form, "name");
    const file = form.get("file");
    if (!odooProductId) return fail("bad_request", "odoo_id is required", 400);
    if (!isProductAssetKind(kind) || !FILE_ASSET_KINDS.has(kind)) {
      return fail("bad_request", "kind must be pdf, image, or video", 400);
    }
    if (!name) return fail("bad_request", "name is required", 400);
    if (!(file instanceof File)) {
      return fail("bad_request", "file is required", 400);
    }
    if (file.size > PRODUCT_FILE_MAX_BYTES) {
      return fail(
        "bad_request",
        `file exceeds 64 MB (got ${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
        400,
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const product = await attachProductAssetFromOdoo(
      ctx.supabase,
      ctx.accountId,
      {
        odooProductId,
        bytes,
        asset: {
          odoo_id: formText(form, "asset_odoo_id") || null,
          kind,
          name,
          filename: formText(form, "filename") || file.name || name,
          mime_type: formText(form, "mimetype") || file.type || null,
          sort_order: Number(formText(form, "sort_order") || 10) || 10,
        },
      },
    );
    return ok(product);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
