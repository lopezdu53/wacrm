"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  youTubeVideoId,
  youTubeThumbnail,
  youTubeWatchUrl,
  urlHostname,
  type LinkPreviewData,
} from "@/lib/inbox/link-preview";

// Tiny module-level cache so re-renders / re-opening a thread don't
// re-hit the unfurl endpoint for URLs we've already resolved.
const cache = new Map<string, LinkPreviewData | null>();

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-background/60 text-foreground">
      {children}
    </div>
  );
}

/** YouTube renders instantly from the thumbnail CDN — no server call. */
function YouTubeCard({ url, videoId }: { url: string; videoId: string }) {
  const t = useTranslations("Inbox.bubble");
  return (
    <a
      href={youTubeWatchUrl(videoId) || url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-60 max-w-full"
    >
      <CardShell>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={youTubeThumbnail(videoId)}
            alt=""
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70">
              <Play className="h-5 w-5 translate-x-[1px] fill-white text-white" />
            </span>
          </div>
        </div>
        <div className="px-3 py-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("youtube")}
          </span>
        </div>
      </CardShell>
    </a>
  );
}

/** Generic web link — unfurled via /api/link-preview. */
function WebCard({ url }: { url: string }) {
  const [data, setData] = useState<LinkPreviewData | null | undefined>(
    cache.has(url) ? cache.get(url) : undefined,
  );

  useEffect(() => {
    if (data !== undefined) return; // cached hit or already resolved
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        const json = (await res.json()) as { data?: LinkPreviewData | null };
        const result = json.data ?? null;
        if (!cancelled) {
          cache.set(url, result);
          setData(result);
        }
      } catch {
        if (!cancelled) {
          cache.set(url, null);
          setData(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, data]);

  // While loading, or when there's nothing to show, render nothing —
  // the raw URL already appears in the message text above.
  if (!data) return null;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-60 max-w-full"
    >
      <CardShell>
        {data.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.image}
            alt=""
            className="max-h-40 w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="px-3 py-2">
          {data.title && (
            <p className="line-clamp-2 text-xs font-semibold leading-snug">
              {data.title}
            </p>
          )}
          {data.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {data.description}
            </p>
          )}
          <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {data.siteName || urlHostname(data.url)}
          </p>
        </div>
      </CardShell>
    </a>
  );
}

/**
 * Renders a rich preview card for the first URL found in a message.
 * YouTube links get an instant thumbnail; other links are unfurled
 * server-side. Renders nothing when there's no preview to show.
 */
export function LinkPreview({ url }: { url: string }) {
  const videoId = youTubeVideoId(url);
  if (videoId) return <YouTubeCard url={url} videoId={videoId} />;
  return <WebCard url={url} />;
}
