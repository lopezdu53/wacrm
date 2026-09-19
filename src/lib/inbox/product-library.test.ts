import { describe, expect, it } from "vitest";

import {
  filterProductSendables,
  isProductAssetKind,
  listProductSendables,
  mediaKindForAsset,
  type ProductLibraryItem,
} from "./product-library";

const product: ProductLibraryItem = {
  id: "p1",
  odoo_id: "12",
  name: "Envasadora",
  sku: "ENV-1",
  description: "Semi automática",
  website_url: "https://example.com/envasadora",
  youtube_url: "https://youtu.be/abc",
  inventory_product_ref: "45",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  assets: [
    {
      id: "a1",
      odoo_id: "1",
      kind: "pdf",
      name: "Ficha técnica",
      url: "https://cdn.example/ficha.pdf",
      filename: "ficha.pdf",
      mime_type: "application/pdf",
      sort_order: 10,
    },
    {
      id: "a2",
      odoo_id: "2",
      kind: "image",
      name: "Foto",
      url: "https://cdn.example/foto.jpg",
      filename: "foto.jpg",
      mime_type: "image/jpeg",
      sort_order: 20,
    },
  ],
};

describe("listProductSendables", () => {
  it("includes header links and file assets", () => {
    const items = listProductSendables(product);
    expect(items.map((i) => i.key)).toEqual([
      "header:youtube",
      "header:website",
      "a1",
      "a2",
    ]);
  });
});

describe("filterProductSendables", () => {
  it("returns everything for all", () => {
    expect(filterProductSendables(product, "all")).toHaveLength(4);
  });

  it("keeps only ticked keys", () => {
    const items = filterProductSendables(product, ["a1", "header:website"]);
    expect(items.map((i) => i.key)).toEqual(["header:website", "a1"]);
  });
});

describe("mediaKindForAsset", () => {
  it("maps file kinds to WhatsApp media types", () => {
    expect(mediaKindForAsset("pdf")).toBe("document");
    expect(mediaKindForAsset("image")).toBe("image");
    expect(mediaKindForAsset("video")).toBe("video");
    expect(mediaKindForAsset("youtube")).toBeNull();
  });
});

describe("isProductAssetKind", () => {
  it("accepts known kinds only", () => {
    expect(isProductAssetKind("pdf")).toBe(true);
    expect(isProductAssetKind("zip")).toBe(false);
  });
});
