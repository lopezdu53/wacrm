import type { SupabaseClient } from "@supabase/supabase-js";

import { buildMediaPath } from "@/lib/storage/upload-media";
import { PRODUCT_MEDIA_BUCKET } from "@/lib/inbox/product-library";
import {
  PRODUCT_SELECT,
  serializeProduct,
  type UpsertProductAssetInput,
  type UpsertProductInput,
} from "@/lib/api/v1/products";
import { badRequest } from "@/lib/api/v1/respond";

const FILE_KINDS = new Set(["pdf", "image", "video"]);

function decodeBase64(value: string): Buffer {
  const trimmed = value.includes(",") ? value.split(",").pop()! : value;
  return Buffer.from(trimmed, "base64");
}

async function uploadAssetFile(
  supabase: SupabaseClient,
  accountId: string,
  asset: UpsertProductAssetInput,
): Promise<{ url: string; path: string }> {
  if (!asset.content_base64) {
    throw badRequest(`asset ${asset.name} is missing content_base64`);
  }
  const buf = decodeBase64(asset.content_base64);
  if (buf.length === 0) {
    throw badRequest(`asset ${asset.name} has empty file data`);
  }
  if (buf.length > 16 * 1024 * 1024) {
    throw badRequest(`asset ${asset.name} exceeds 16 MB`);
  }
  const filename = asset.filename || `${asset.name}.bin`;
  const path = buildMediaPath(accountId, filename);
  const { error } = await supabase.storage.from(PRODUCT_MEDIA_BUCKET).upload(path, buf, {
    upsert: true,
    contentType: asset.mime_type || "application/octet-stream",
  });
  if (error) {
    throw badRequest(`Could not store ${asset.name}: ${error.message}`);
  }
  const { data } = supabase.storage.from(PRODUCT_MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function upsertProductFromOdoo(
  supabase: SupabaseClient,
  accountId: string,
  input: UpsertProductInput,
) {
  const now = new Date().toISOString();
  const header = {
    account_id: accountId,
    odoo_id: input.odoo_id,
    name: input.name,
    sku: input.sku ?? null,
    description: input.description ?? null,
    website_url: input.website_url ?? null,
    youtube_url: input.youtube_url ?? null,
    inventory_product_ref: input.inventory_product_ref ?? null,
    active: input.active !== false,
    updated_at: now,
  };

  const { data: existing, error: findErr } = await supabase
    .from("product_library")
    .select("id")
    .eq("account_id", accountId)
    .eq("odoo_id", input.odoo_id)
    .maybeSingle();
  if (findErr) throw findErr;

  let productId: string;
  if (existing?.id) {
    const { error } = await supabase
      .from("product_library")
      .update(header)
      .eq("id", existing.id);
    if (error) throw error;
    productId = existing.id as string;
  } else {
    const { data, error } = await supabase
      .from("product_library")
      .insert(header)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert failed");
    productId = data.id as string;
  }

  const { data: oldAssets } = await supabase
    .from("product_assets")
    .select("id, storage_path")
    .eq("product_id", productId);
  const stalePaths = (oldAssets ?? [])
    .map((a) => a.storage_path as string | null)
    .filter((p): p is string => Boolean(p));
  if (stalePaths.length) {
    await supabase.storage.from(PRODUCT_MEDIA_BUCKET).remove(stalePaths);
  }
  await supabase.from("product_assets").delete().eq("product_id", productId);

  for (const asset of input.assets ?? []) {
    let url = asset.url ?? null;
    let storagePath: string | null = null;
    if (FILE_KINDS.has(asset.kind)) {
      const uploaded = await uploadAssetFile(supabase, accountId, asset);
      url = uploaded.url;
      storagePath = uploaded.path;
    } else if (!url) {
      throw badRequest(`asset ${asset.name} needs a url`);
    }

    const { error } = await supabase.from("product_assets").insert({
      account_id: accountId,
      product_id: productId,
      odoo_id: asset.odoo_id ?? null,
      kind: asset.kind,
      name: asset.name,
      url,
      storage_path: storagePath,
      filename: asset.filename ?? null,
      mime_type: asset.mime_type ?? null,
      sort_order: asset.sort_order ?? 10,
    });
    if (error) throw error;
  }

  const { data: row, error: loadErr } = await supabase
    .from("product_library")
    .select(PRODUCT_SELECT)
    .eq("id", productId)
    .single();
  if (loadErr || !row) throw loadErr ?? new Error("reload failed");
  return serializeProduct(row as Record<string, unknown>);
}
