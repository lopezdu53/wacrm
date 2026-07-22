// ============================================================
// Link + media preview helpers (shared client/server).
//
// Pure functions — no React, no fetch — so they're safe to import
// from both the message bubble (client) and the unfurl API route.
// ============================================================

/** Grab the first http(s) URL in a block of text, or null. */
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  // Deliberately permissive: stop at whitespace or the common
  // sentence-closers that usually aren't part of the URL.
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  // Trim trailing punctuation that tends to hug a URL in prose.
  return match[0].replace(/[.,;:!?]+$/, "");
}

/**
 * If `url` is a YouTube watch/share/embed/shorts link, return its
 * 11-char video id; otherwise null. Covers youtube.com/watch?v=,
 * youtu.be/<id>, /embed/<id>, /shorts/<id>, /live/<id>.
 */
export function youTubeVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return isVideoId(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v");
      return id && isVideoId(id) ? id : null;
    }
    const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
    if (m && isVideoId(m[2])) return m[2];
  }
  return null;
}

function isVideoId(id: string | undefined): id is string {
  return !!id && /^[\w-]{11}$/.test(id);
}

/** hqdefault is always present; maxresdefault often 404s, so avoid it. */
export function youTubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Watch URL we link the thumbnail to (canonical form). */
export function youTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Best-effort "is this a PDF" from a filename and/or its URL. */
export function looksLikePdf(
  name: string | null | undefined,
  url: string | null | undefined,
): boolean {
  const hay = `${name ?? ""} ${url ?? ""}`.toLowerCase();
  return /\.pdf(\?|#|$|\s)/.test(hay) || hay.includes("application/pdf");
}

/** Short "example.com" label from a URL, for the preview card footer. */
export function urlHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}
