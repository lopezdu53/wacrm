"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useDashboardNav } from "@/components/layout/dashboard-nav-context";
import { createClient } from "@/lib/supabase/client";
import {
  conversationAlertTag,
  emitLocalAlert,
  internalAlertTag,
  shouldSuppressAlert,
} from "@/lib/pwa/local-alert";
import type { Notification } from "@/types";

/**
 * Turns in-app notification rows and internal-chat inserts into a
 * phone-tray alert + beep while the PWA is open. Web Push still
 * covers the killed-app case when VAPID is configured.
 */
export function IncomingAlerts() {
  const { user } = useAuth();
  const { viewingConversationId, viewingInternalChannelId } =
    useDashboardNav();
  const viewingConvRef = useRef(viewingConversationId);
  const viewingInternalRef = useRef(viewingInternalChannelId);
  viewingConvRef.current = viewingConversationId;
  viewingInternalRef.current = viewingInternalChannelId;

  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();

    const onNotification = (row: Notification | undefined) => {
      if (!row || row.read_at) return;
      const conversationId = row.conversation_id ?? "";
      const tag = conversationId
        ? conversationAlertTag(conversationId)
        : `note:${row.id}`;
      if (
        shouldSuppressAlert({
          tag,
          viewingConversationId: viewingConvRef.current,
        })
      ) {
        return;
      }
      void emitLocalAlert({
        title: row.title || "wacrm",
        body: row.body || "",
        url: conversationId
          ? `/inbox?c=${encodeURIComponent(conversationId)}`
          : "/notifications",
        tag,
      });
    };

    const channel = supabase
      .channel("incoming-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => onNotification(payload.new as Notification),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as Notification;
          if (row.read_at) return;
          onNotification(row);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages" },
        (payload) => {
          const row = payload.new as {
            channel_id?: string;
            sender_id?: string;
            content?: string;
          };
          if (!row.channel_id || row.sender_id === user.id) return;
          const tag = internalAlertTag(row.channel_id);
          if (
            shouldSuppressAlert({
              tag,
              viewingInternalChannelId: viewingInternalRef.current,
            })
          ) {
            return;
          }
          void emitLocalAlert({
            title: "Interno",
            body: (row.content ?? "").trim() || "Nuevo mensaje interno",
            url: "/internal-chat",
            tag,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return null;
}
