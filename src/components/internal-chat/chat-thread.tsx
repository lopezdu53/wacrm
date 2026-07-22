"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { format } from "date-fns";
import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  channelLabel,
  type InternalChannel,
  type InternalMessage,
} from "@/lib/internal-chat/types";

interface ChatThreadProps {
  channel: InternalChannel;
  currentUserId: string;
  /** Called after a message is sent or received so the list can refresh. */
  onActivity: () => void;
}

export function ChatThread({ channel, currentUserId, onActivity }: ChatThreadProps) {
  const t = useTranslations("InternalChat");
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const memberById = new Map(channel.members.map((m) => [m.user_id, m]));

  const markRead = useCallback(() => {
    void fetch(`/api/internal-chat/channels/${channel.id}/read`, {
      method: "POST",
    }).then(() => onActivity());
  }, [channel.id, onActivity]);

  // Load history + subscribe to new messages for this channel.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    seenIds.current = new Set();
    setLoading(true);
    setMessages([]);

    (async () => {
      const { data } = await supabase
        .from("internal_messages")
        .select("id, channel_id, sender_id, content, created_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const rows = (data ?? []) as InternalMessage[];
      rows.forEach((m) => seenIds.current.add(m.id));
      setMessages(rows);
      setLoading(false);
      markRead();
    })();

    const sub = supabase
      .channel(`internal-chat-${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "internal_messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          const msg = payload.new as InternalMessage;
          if (seenIds.current.has(msg.id)) return;
          seenIds.current.add(msg.id);
          setMessages((prev) => [...prev, msg]);
          if (msg.sender_id !== currentUserId) markRead();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
  }, [channel.id, currentUserId, markRead]);

  // Keep pinned to the latest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/internal-chat/channels/${channel.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as { message?: InternalMessage };
        setText("");
        if (json.message && !seenIds.current.has(json.message.id)) {
          seenIds.current.add(json.message.id);
          setMessages((prev) => [...prev, json.message!]);
        }
        onActivity();
      }
    } finally {
      setSending(false);
    }
  }

  const title = channelLabel(channel, currentUserId);
  const subtitle =
    channel.kind === "group"
      ? t("membersCount", { count: channel.members.length })
      : t("directMessage");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("noMessages")}</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            const author = memberById.get(m.sender_id);
            return (
              <div
                key={m.id}
                className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
              >
                {!mine && (
                  <Avatar className="mt-auto size-7 shrink-0">
                    {author?.avatar_url ? (
                      <AvatarImage src={author.avatar_url} alt={author.full_name} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-[11px] font-medium text-primary">
                      {(author?.full_name || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-3 py-2",
                    mine
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md bg-muted text-foreground",
                  )}
                >
                  {!mine && channel.kind === "group" && (
                    <p className="mb-0.5 text-[11px] font-semibold text-primary">
                      {author?.full_name || t("someone")}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {format(new Date(m.created_at), "HH:mm")}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder={t("composerPlaceholder")}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!text.trim() || sending}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            aria-label={t("send")}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
