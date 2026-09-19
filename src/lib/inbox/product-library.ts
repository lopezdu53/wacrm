export const PRODUCT_MEDIA_BUCKET = "product-media";

export const PRODUCT_ASSET_KINDS = [
  "pdf",
  "image",
  "video",
  "youtube",
  "website",
] as const;

export type ProductAssetKind = (typeof PRODUCT_ASSET_KINDS)[number];

export interface ProductAsset {
  id: string;
  odoo_id: string | null;
  kind: ProductAssetKind;
  name: string;
  url: string | null;
  filename: string | null;
  mime_type: string | null;
  sort_order: number;
}

export interface ProductLibraryItem {
  id: string;
  odoo_id: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  website_url: string | null;
  youtube_url: string | null;
  inventory_product_ref: string | null;
  active: boolean;
  assets: ProductAsset[];
  created_at: string;
  updated_at: string;
}

export interface ProductSendItem {
  key: string;
  kind: ProductAssetKind;
  label: string;
  url: string;
  filename?: string;
}

export function isProductAssetKind(value: unknown): value is ProductAssetKind {
  return (
    typeof value === "string" &&
    (PRODUCT_ASSET_KINDS as readonly string[]).includes(value)
  );
}

/** Header YouTube/web links plus file/url assets, ready to tick in the picker. */
export function listProductSendables(
  product: ProductLibraryItem,
): ProductSendItem[] {
  const items: ProductSendItem[] = [];
  if (product.youtube_url) {
    items.push({
      key: "header:youtube",
      kind: "youtube",
      label: product.youtube_url,
      url: product.youtube_url,
    });
  }
  if (product.website_url) {
    items.push({
      key: "header:website",
      kind: "website",
      label: product.website_url,
      url: product.website_url,
    });
  }
  const sorted = [...product.assets].sort((a, b) => a.sort_order - b.sort_order);
  for (const asset of sorted) {
    if (!asset.url) continue;
    items.push({
      key: asset.id,
      kind: asset.kind,
      label: asset.name,
      url: asset.url,
      filename: asset.filename ?? undefined,
    });
  }
  return items;
}

export function filterProductSendables(
  product: ProductLibraryItem,
  selectedKeys: string[] | "all",
): ProductSendItem[] {
  const all = listProductSendables(product);
  if (selectedKeys === "all") return all;
  const want = new Set(selectedKeys);
  return all.filter((item) => want.has(item.key));
}

export function mediaKindForAsset(
  kind: ProductAssetKind,
): "image" | "video" | "document" | null {
  if (kind === "image") return "image";
  if (kind === "video") return "video";
  if (kind === "pdf") return "document";
  return null;
}
