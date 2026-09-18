import { brandIconPng } from "@/lib/pwa/brand-icon";

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon (Safari → Add to Home Screen). */
export default function AppleIcon() {
  return brandIconPng(180, { radius: 40 });
}
