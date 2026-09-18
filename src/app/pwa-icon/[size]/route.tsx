import { brandIconPng } from "@/lib/pwa/brand-icon";

export const runtime = "edge";

const VARIANTS: Record<string, { size: number; padding: number }> = {
  "192": { size: 192, padding: 0 },
  "512": { size: 512, padding: 0 },
  maskable: { size: 512, padding: 64 },
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
) {
  const { size } = await context.params;
  const variant = VARIANTS[size];
  if (!variant) {
    return new Response("Not found", { status: 404 });
  }
  return brandIconPng(variant.size, {
    padding: variant.padding,
    radius: Math.round(variant.size * 0.2),
  });
}
