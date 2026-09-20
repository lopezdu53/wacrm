"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { conversationIsOpportunity } from "@/lib/inbox/conversations";
import type { Conversation } from "@/types";

export type LaneUnread = { inbox: number; opportunity: number };

/**
 * Unread WhatsApp counts split between Inbox and Oportunidades.
 * One realtime channel so both tab badges stay in sync.
 */
export function useLaneUnread(userId?: string | null): LaneUnread {
  const [totals, setTotals] = useState<LaneUnread>({
    inbox: 0,
    opportunity: 0,
  });
  const channelName = `lane-unread-realtime:${useId()}`;
  const rowsRef = useRef<Map<string, { unread: number; opportunity: boolean }>>(
    new Map(),
  );

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;

    const publish = () => {
      let inbox = 0;
      let opportunity = 0;
      for (const row of rowsRef.current.values()) {
        if (row.unread <= 0) continue;
        if (row.opportunity) opportunity += row.unread;
        else inbox += row.unread;
      }
      setTotals({ inbox, opportunity });
    };

    const remember = (
      id: string | undefined,
      unread: number | undefined,
      isOpportunity: boolean | null | undefined,
    ) => {
      if (!id) return;
      rowsRef.current.set(id, {
        unread: Number(unread) || 0,
        opportunity: conversationIsOpportunity({
          is_opportunity: isOpportunity,
        }),
      });
    };

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, unread_count, is_opportunity");
      if (cancelled) return;
      if (error) {
        const fallback = await supabase
          .from("conversations")
          .select("id, unread_count");
        if (cancelled || fallback.error || !fallback.data) return;
        rowsRef.current = new Map();
        for (const row of fallback.data as {
          id: string;
          unread_count: number;
        }[]) {
          remember(row.id, row.unread_count, false);
        }
        publish();
        return;
      }
      rowsRef.current = new Map();
      for (const row of data as {
        id: string;
        unread_count: number;
        is_opportunity?: boolean | null;
      }[]) {
        remember(row.id, row.unread_count, row.is_opportunity);
      }
      publish();
    })();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) rowsRef.current.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            remember(row.id, row.unread_count, row.is_opportunity);
          }
          publish();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [channelName, userId]);

  return totals;
}
