"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Total count of internal-chat channels with at least one unread
 * message for the current user. Drives the sidebar badge on the
 * "Internal chat" entry.
 *
 * Refetches from the channels API on mount and whenever a new internal
 * message lands anywhere (RLS scopes the realtime stream to the user's
 * own channels), so the badge stays live without per-channel wiring.
 */
export function useInternalUnread(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/internal-chat/channels", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          channels?: { unread_count: number }[];
        };
        if (cancelled) return;
        const count = (json.channels ?? []).filter(
          (c) => c.unread_count > 0,
        ).length;
        setTotal(count);
      } catch {
        /* best-effort */
      }
    }

    void refresh();

    const channel = supabase
      .channel("internal-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages" },
        () => void refresh(),
      )
      .subscribe();

    // Catch up on focus (covers messages missed while the tab slept).
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return total;
}
