// ============================================================
// GET /api/link-preview?url=<encoded>
//
// Server-side "unfurl": fetches a web page and extracts its
// Open Graph / <title> metadata so the inbox can render a rich
// link-preview card (image + title + description).
//
// Guardrails
//   - Auth-gated (any logged-in user) so it isn't an open proxy.
//   - Only http/https, and obvious private/loopback hosts are
//     rejected to blunt SSRF into the internal network.
//   - 5s timeout, response capped at ~512 KB, HTML only.
//   - Result cached at the edge (public, 1h) — previews are stable.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { LinkPreviewData } from "@/lib/inbox/link-preview";

const MAX_BYTES = 512 * 1024; // 512 KB is plenty for <head>
const TIMEOUT_MS = 5000;

/** Reject loopback / link-local / private-range hosts (basic SSRF guard). */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) {
    return true;
  }
  // Cloud metadata endpoint.
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  // IPv6 loopback / unspecified.
  if (h === "::1" || h === "[::1]" || h === "::" ) return true;
  // IPv4 literals in private / loopback / link-local ranges.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function pickMeta(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/** Build both attribute orders for an og/twitter meta tag. */
function metaPatterns(prop: string): RegExp[] {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`,
      "i",
    ),
  ];
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = new URL(request.url).searchParams.get("url");
    if (!raw) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
    }
    if (isBlockedHost(target.hostname)) {
      return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(target.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // Some sites gate OG tags behind a "real" UA.
          "User-Agent":
            "Mozilla/5.0 (compatible; wacrm-linkpreview/1.0; +https://github.com/lopezdu53/wacrm)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      clearTimeout(timer);
      // Network error / timeout — no preview, not an app error.
      return NextResponse.json({ data: null });
    }
    clearTimeout(timer);

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("html")) {
      return NextResponse.json({ data: null });
    }

    // Read at most MAX_BYTES so a huge page can't blow up memory.
    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (received < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        // Once we've seen </head> we have all the meta we need.
        if (/<\/head>/i.test(html)) break;
      }
      await reader.cancel().catch(() => {});
    } else {
      html = (await res.text()).slice(0, MAX_BYTES);
    }

    const image = pickMeta(html, [
      ...metaPatterns("og:image:secure_url"),
      ...metaPatterns("og:image"),
      ...metaPatterns("twitter:image"),
      ...metaPatterns("twitter:image:src"),
    ]);

    const data: LinkPreviewData = {
      url: target.toString(),
      title:
        pickMeta(html, [...metaPatterns("og:title"), ...metaPatterns("twitter:title")]) ??
        pickMeta(html, [/<title[^>]*>([^<]*)<\/title>/i]),
      description: pickMeta(html, [
        ...metaPatterns("og:description"),
        ...metaPatterns("twitter:description"),
        ...metaPatterns("description"),
      ]),
      image: image ? new URL(image, target).toString() : null,
      siteName: pickMeta(html, metaPatterns("og:site_name")),
    };

    // Nothing worth showing.
    if (!data.title && !data.image && !data.description) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
    );
  } catch (err) {
    console.error("[link-preview] failed:", err);
    return NextResponse.json({ data: null });
  }
}
