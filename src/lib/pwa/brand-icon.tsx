import { ImageResponse } from "next/og";

/**
 * Shared PNG used by the favicon, apple-touch-icon, and PWA manifest
 * icons. Keep the mark in one place so the home-screen glyph matches
 * the sidebar logo (Hostinger-aligned purple square + chat stroke).
 */
export function brandIconPng(
  size: number,
  opts: { radius?: number; padding?: number } = {},
): ImageResponse {
  const radius = opts.radius ?? Math.round(size * 0.2);
  const padding = opts.padding ?? 0;
  const inner = size - padding * 2;
  const glyph = Math.round(inner * 0.62);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: padding ? "#020617" : "#7c3aed",
        }}
      >
        <div
          style={{
            width: inner,
            height: inner,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#7c3aed",
            borderRadius: radius,
          }}
        >
          <svg
            width={glyph}
            height={glyph}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
