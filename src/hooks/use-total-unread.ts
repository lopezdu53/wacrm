"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sumUnread } from "@/lib/inbox/unread";
import type { Conversation } from "@/types";

/**
 * Total unread WhatsApp messages for the current user (sum of
 * conversation.unread_count). Drives the Chats tab badge.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(userId?: string | null): number {
  const [total, setTotal] = useState(0);
  const channelName = `total-unread-realtime:${useId()}`;

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, unread_count");
      if (cancelled || error || !data) return;

      const map = new Map<string, number>();
      for (const row of data as { id: string; unread_count: number }[]) {
        map.set(row.id, Number(row.unread_count) || 0);
      }
      countsRef.current = map;
      setTotal(sumUnread(map.values()));
    })();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            map.set(row.id, Number(row.unread_count) || 0);
          }
          setTotal(sumUnread(map.values()));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [channelName, userId]);

  return total;
}
