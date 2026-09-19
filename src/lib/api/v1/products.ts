import {
  isProductAssetKind,
  type ProductAsset,
  type ProductAssetKind,
  type ProductLibraryItem,
} from "@/lib/inbox/product-library";

export const PRODUCT_SELECT = "*, assets:product_assets(*)";

export function serializeProduct(row: Record<string, unknown>): ProductLibraryItem {
  const rawAssets = (row.assets as Record<string, unknown>[] | null) ?? [];
  const assets: ProductAsset[] = rawAssets
    .filter((a) => isProductAssetKind(a.kind))
    .map((a) => ({
      id: a.id as string,
      odoo_id: (a.odoo_id as string | null) ?? null,
      kind: a.kind as ProductAssetKind,
      name: (a.name as string) ?? "",
      url: (a.url as string | null) ?? null,
      filename: (a.filename as string | null) ?? null,
      mime_type: (a.mime_type as string | null) ?? null,
      sort_order: Number(a.sort_order ?? 10),
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  return {
    id: row.id as string,
    odoo_id: (row.odoo_id as string | null) ?? null,
    name: (row.name as string) ?? "",
    sku: (row.sku as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    website_url: (row.website_url as string | null) ?? null,
    youtube_url: (row.youtube_url as string | null) ?? null,
    inventory_product_ref: (row.inventory_product_ref as string | null) ?? null,
    active: row.active !== false,
    assets,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export interface UpsertProductAssetInput {
  odoo_id?: string | null;
  kind: ProductAssetKind;
  name: string;
  url?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  content_base64?: string | null;
  sort_order?: number;
}

export interface UpsertProductInput {
  odoo_id: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  website_url?: string | null;
  youtube_url?: string | null;
  inventory_product_ref?: string | null;
  active?: boolean;
  assets?: UpsertProductAssetInput[];
}

export function parseUpsertProduct(body: unknown): UpsertProductInput | string {
  if (!body || typeof body !== "object") return "JSON body is required";
  const raw = body as Record<string, unknown>;
  const odoo_id = typeof raw.odoo_id === "string" ? raw.odoo_id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!odoo_id) return "odoo_id is required";
  if (!name) return "name is required";

  const assets: UpsertProductAssetInput[] = [];
  if (raw.assets !== undefined) {
    if (!Array.isArray(raw.assets)) return "assets must be an array";
    for (const entry of raw.assets) {
      if (!entry || typeof entry !== "object") return "each asset must be an object";
      const a = entry as Record<string, unknown>;
      if (!isProductAssetKind(a.kind)) return "asset.kind is invalid";
      const assetName = typeof a.name === "string" ? a.name.trim() : "";
      if (!assetName) return "asset.name is required";
      assets.push({
        odoo_id: typeof a.odoo_id === "string" ? a.odoo_id : null,
        kind: a.kind,
        name: assetName,
        url: typeof a.url === "string" ? a.url : null,
        filename: typeof a.filename === "string" ? a.filename : null,
        mime_type: typeof a.mimetype === "string" ? a.mimetype : typeof a.mime_type === "string" ? a.mime_type : null,
        content_base64:
          typeof a.content_base64 === "string" ? a.content_base64 : null,
        sort_order: typeof a.sort_order === "number" ? a.sort_order : 10,
      });
    }
  }

  return {
    odoo_id,
    name,
    sku: typeof raw.sku === "string" ? raw.sku : null,
    description: typeof raw.description === "string" ? raw.description : null,
    website_url: typeof raw.website_url === "string" ? raw.website_url : null,
    youtube_url: typeof raw.youtube_url === "string" ? raw.youtube_url : null,
    inventory_product_ref:
      typeof raw.inventory_product_ref === "string"
        ? raw.inventory_product_ref
        : null,
    active: raw.active === false ? false : true,
    assets,
  };
}
