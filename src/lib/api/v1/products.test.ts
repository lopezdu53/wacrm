import { describe, expect, it } from "vitest";

import { parseUpsertProduct, serializeProduct } from "./products";

describe("parseUpsertProduct", () => {
  it("requires odoo_id and name", () => {
    expect(parseUpsertProduct({})).toBe("odoo_id is required");
    expect(parseUpsertProduct({ odoo_id: "1" })).toBe("name is required");
  });

  it("accepts a full product with assets", () => {
    const parsed = parseUpsertProduct({
      odoo_id: "12",
      name: "Envasadora",
      sku: "ENV-1",
      assets: [
        {
          odoo_id: "3",
          kind: "pdf",
          name: "Ficha",
          filename: "ficha.pdf",
          mimetype: "application/pdf",
          content_base64: "AAAA",
        },
      ],
    });
    expect(parsed).toMatchObject({
      odoo_id: "12",
      name: "Envasadora",
      sku: "ENV-1",
    });
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.assets?.[0]?.mime_type).toBe("application/pdf");
  });
});

describe("serializeProduct", () => {
  it("maps nested assets", () => {
    const out = serializeProduct({
      id: "p1",
      odoo_id: "12",
      name: "X",
      sku: null,
      description: null,
      website_url: null,
      youtube_url: null,
      inventory_product_ref: null,
      active: true,
      created_at: "t",
      updated_at: "t",
      assets: [
        {
          id: "a1",
          odoo_id: "1",
          kind: "image",
          name: "Foto",
          url: "https://x/a.jpg",
          filename: "a.jpg",
          mime_type: "image/jpeg",
          sort_order: 5,
        },
      ],
    });
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]?.kind).toBe("image");
  });
});
