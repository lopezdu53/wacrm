"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Users, User } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import { fetchAccountMembers, memberLabel } from "@/lib/account/members";
import type { AccountMember } from "@/types";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

interface NewChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
  onCreated: (channelId: string) => void;
}

export function NewChannelDialog({
  open,
  onOpenChange,
  currentUserId,
  onCreated,
}: NewChannelDialogProps) {
  const t = useTranslations("InternalChat");
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset each time the dialog opens.
    setMode("dm");
    setSelected(new Set());
    setGroupName("");
    setSearch("");
    void fetchAccountMembers().then((all) =>
      setMembers(all.filter((m) => m.user_id !== currentUserId)),
    );
  }, [open, currentUserId]);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (mode === "dm") {
        // Single-select for DMs.
        next.clear();
        if (!prev.has(userId)) next.add(userId);
      } else if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  const filtered = members.filter((m) =>
    memberLabel(m).toLowerCase().includes(search.trim().toLowerCase()),
  );

  const canCreate =
    mode === "dm"
      ? selected.size === 1
      : groupName.trim().length > 0 && selected.size >= 1;

  async function handleCreate() {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/internal-chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: mode,
          memberIds: [...selected],
          name: mode === "group" ? groupName.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t("createFailed"));
        return;
      }
      const json = (await res.json()) as { id: string };
      onOpenChange(false);
      onCreated(json.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("newChat")}</DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("dm");
              setSelected(new Set());
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              mode === "dm"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <User className="size-4" />
            {t("directMessage")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("group");
              setSelected(new Set());
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              mode === "group"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <Users className="size-4" />
            {t("group")}
          </button>
        </div>

        {mode === "group" && (
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder={t("groupNamePlaceholder")}
            className="bg-card border-border text-foreground"
          />
        )}

        {/* Member search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchMembers")}
            className="bg-card border-border pl-8 text-foreground"
          />
        </div>

        {/* Member list */}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("noMembers")}
            </p>
          ) : (
            filtered.map((m) => {
              const isSel = selected.has(m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => toggle(m.user_id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                    isSel ? "bg-primary/10" : "hover:bg-muted",
                  )}
                >
                  <Avatar className="size-8 shrink-0">
                    {m.avatar_url ? (
                      <AvatarImage src={m.avatar_url} alt={m.full_name} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                      {(m.full_name || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-sm text-popover-foreground">
                    {memberLabel(m)}
                  </span>
                  <span
                    className={cn(
                      "size-4 shrink-0 rounded-full border",
                      isSel
                        ? "border-primary bg-primary"
                        : "border-border",
                    )}
                  />
                </button>
              );
            })
          )}
        </div>

        <Button
          onClick={handleCreate}
          disabled={!canCreate || creating}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {creating && <Loader2 className="size-4 animate-spin" />}
          {t("startChat")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
