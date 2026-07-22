"use client";

import { useCallback, useEffect, useState } from "react";
import { format, isToday } from "date-fns";
import { Loader2, MessagesSquare, Plus, Users } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { ChatThread } from "@/components/internal-chat/chat-thread";
import { NewChannelDialog } from "@/components/internal-chat/new-channel-dialog";
import { channelLabel, type InternalChannel } from "@/lib/internal-chat/types";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";

export default function InternalChatPage() {
  const t = useTranslations("InternalChat");
  const { user } = useAuth();
  const currentUserId = user?.id ?? "";

  const [channels, setChannels] = useState<InternalChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/internal-chat/channels", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { channels?: InternalChannel[] };
      setChannels(json.channels ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live-refresh the channel list when any internal message lands.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("internal-chat-list")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  const active = channels.find((c) => c.id === activeId) ?? null;
  const visible = tab === "unread" ? channels.filter((c) => c.unread_count > 0) : channels;
  const totalUnread = channels.filter((c) => c.unread_count > 0).length;

  function onCreated(channelId: string) {
    void refresh();
    setActiveId(channelId);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-border">
      {/* Channel list */}
      <div
        className={cn(
          "flex w-full flex-col border-r border-border sm:w-80 sm:shrink-0",
          active ? "hidden sm:flex" : "flex",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <h1 className="text-sm font-semibold text-foreground">{t("title")}</h1>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" />
            {t("newChat")}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-3 py-2">
          {(["unread", "all"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(key === "unread" ? "tabUnread" : "tabAll")}
              {key === "unread" && totalUnread > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {totalUnread}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <MessagesSquare className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {tab === "unread" ? t("noUnread") : t("noChannels")}
              </p>
            </div>
          ) : (
            <ul>
              {visible.map((c) => {
                const label = channelLabel(c, currentUserId);
                const preview = c.last_message?.content ?? "";
                const ts = c.last_message_at;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors",
                        c.id === activeId ? "bg-muted" : "hover:bg-muted/50",
                      )}
                    >
                      {c.kind === "group" ? (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Users className="size-4" />
                        </div>
                      ) : (
                        (() => {
                          const other = c.members.find(
                            (m) => m.user_id !== currentUserId,
                          );
                          return (
                            <Avatar className="size-9 shrink-0">
                              {other?.avatar_url ? (
                                <AvatarImage src={other.avatar_url} alt={label} />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                                {label.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          );
                        })()
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {label}
                          </span>
                          {ts && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {isToday(new Date(ts))
                                ? format(new Date(ts), "HH:mm")
                                : format(new Date(ts), "MMM d")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {preview || t("noMessagesShort")}
                          </span>
                          {c.unread_count > 0 && (
                            <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                              {c.unread_count > 9 ? "9+" : c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className={cn("flex-1", active ? "flex" : "hidden sm:flex")}>
        {active && currentUserId ? (
          <div className="flex w-full flex-col">
            {/* Mobile back button */}
            <button
              type="button"
              onClick={() => setActiveId(null)}
              className="border-b border-border px-4 py-2 text-left text-xs text-primary sm:hidden"
            >
              ← {t("back")}
            </button>
            <div className="min-h-0 flex-1">
              <ChatThread
                channel={active}
                currentUserId={currentUserId}
                onActivity={refresh}
              />
            </div>
          </div>
        ) : (
          <div className="hidden flex-1 items-center justify-center sm:flex">
            <div className="flex flex-col items-center gap-2 text-center">
              <MessagesSquare className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("selectAChat")}</p>
            </div>
          </div>
        )}
      </div>

      <NewChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentUserId={currentUserId}
        onCreated={onCreated}
      />
    </div>
  );
}
