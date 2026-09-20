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

export const FILE_ASSET_KINDS = new Set(["pdf", "image", "video"]);

/** Files bigger than this stay out of the JSON PUT (base64 explodes ~33%). */
export const PRODUCT_INLINE_MAX_BYTES = 2 * 1024 * 1024;

/** Stored library files. WhatsApp video playback is still ~16 MB. */
export const PRODUCT_FILE_MAX_BYTES = 64 * 1024 * 1024;

function decodeBase64(value: string): Buffer {
  const trimmed = value.includes(",") ? value.split(",").pop()! : value;
  return Buffer.from(trimmed, "base64");
}

export async function storeProductAssetBytes(
  supabase: SupabaseClient,
  accountId: string,
  args: {
    name: string;
    filename?: string | null;
    mimeType?: string | null;
    bytes: Buffer;
  },
): Promise<{ url: string; path: string }> {
  if (args.bytes.length === 0) {
    throw badRequest(`asset ${args.name} has empty file data`);
  }
  if (args.bytes.length > PRODUCT_FILE_MAX_BYTES) {
    throw badRequest(
      `asset ${args.name} exceeds 64 MB (got ${(args.bytes.length / (1024 * 1024)).toFixed(1)} MB)`,
    );
  }
  const filename = args.filename || `${args.name}.bin`;
  const path = buildMediaPath(accountId, filename);
  const { error } = await supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .upload(path, args.bytes, {
      upsert: true,
      contentType: args.mimeType || "application/octet-stream",
    });
  if (error) {
    throw badRequest(`Could not store ${args.name}: ${error.message}`);
  }
  const { data } = supabase.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .getPublicUrl(path);
  return { url: data.publicUrl, path };
}

async function uploadInlineAsset(
  supabase: SupabaseClient,
  accountId: string,
  asset: UpsertProductAssetInput,
): Promise<{ url: string; path: string }> {
  if (!asset.content_base64) {
    throw badRequest(`asset ${asset.name} is missing content_base64`);
  }
  return storeProductAssetBytes(supabase, accountId, {
    name: asset.name,
    filename: asset.filename,
    mimeType: asset.mime_type,
    bytes: decodeBase64(asset.content_base64),
  });
}

export async function attachProductAssetFromOdoo(
  supabase: SupabaseClient,
  accountId: string,
  args: {
    odooProductId: string;
    asset: UpsertProductAssetInput;
    bytes: Buffer;
  },
) {
  const { data: product, error: findErr } = await supabase
    .from("product_library")
    .select("id")
    .eq("account_id", accountId)
    .eq("odoo_id", args.odooProductId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!product) throw badRequest("Product not found — push the product first");

  const uploaded = await storeProductAssetBytes(supabase, accountId, {
    name: args.asset.name,
    filename: args.asset.filename,
    mimeType: args.asset.mime_type,
    bytes: args.bytes,
  });

  if (args.asset.odoo_id) {
    const { data: existing } = await supabase
      .from("product_assets")
      .select("id, storage_path")
      .eq("account_id", accountId)
      .eq("odoo_id", args.asset.odoo_id)
      .maybeSingle();
    if (existing?.storage_path) {
      await supabase.storage
        .from(PRODUCT_MEDIA_BUCKET)
        .remove([existing.storage_path as string]);
    }
    if (existing?.id) {
      await supabase.from("product_assets").delete().eq("id", existing.id);
    }
  }

  const { error } = await supabase.from("product_assets").insert({
    account_id: accountId,
    product_id: product.id,
    odoo_id: args.asset.odoo_id ?? null,
    kind: args.asset.kind,
    name: args.asset.name,
    url: uploaded.url,
    storage_path: uploaded.path,
    filename: args.asset.filename ?? null,
    mime_type: args.asset.mime_type ?? null,
    sort_order: args.asset.sort_order ?? 10,
  });
  if (error) throw error;

  const { data: row, error: loadErr } = await supabase
    .from("product_library")
    .select(PRODUCT_SELECT)
    .eq("id", product.id)
    .single();
  if (loadErr || !row) throw loadErr ?? new Error("reload failed");
  return serializeProduct(row as Record<string, unknown>);
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
    if (FILE_ASSET_KINDS.has(asset.kind)) {
      if (!asset.content_base64) {
        // Large files are POSTed separately as multipart.
        continue;
      }
      const uploaded = await uploadInlineAsset(supabase, accountId, asset);
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
