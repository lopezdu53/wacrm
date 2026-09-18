"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, LogOut, MessageSquare, MessagesSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useInternalUnread } from "@/hooks/use-internal-unread";
import {
  APP_NAV_ITEMS,
  MOBILE_TAB_HREFS,
  SETTINGS_NAV_ITEM,
} from "@/components/layout/nav-items";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface MobileTabBarProps {
  hidden?: boolean;
}

/**
 * WhatsApp Business-style bottom tabs on phones. The four destinations
 * the user asked for: Chats, Interno, Noti, Perfil. Everything else
 * (settings, pipelines, sign out) lives under Perfil.
 */
export function MobileTabBar({ hidden = false }: MobileTabBarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const internalUnread = useInternalUnread();
  const [profileOpen, setProfileOpen] = useState(false);

  const restrictedNav =
    accountRole === "agent" || accountRole === "viewer";
  const tabHrefs = new Set<string>(MOBILE_TAB_HREFS);
  const extraItems = [
    ...APP_NAV_ITEMS.filter((item) => !tabHrefs.has(item.href)),
    SETTINGS_NAV_ITEM,
  ].filter((item) => (restrictedNav ? item.href === "/settings" : true));

  const inboxActive = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const internalActive = pathname.startsWith("/internal-chat");
  const notiActive = pathname.startsWith("/notifications");
  const profileActive =
    profileOpen || pathname.startsWith("/settings");

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <>
      <nav
        aria-label={t("mobileTabs")}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md lg:hidden",
          "pb-[env(safe-area-inset-bottom)]",
          hidden && "hidden",
        )}
      >
        <ul className="grid h-14 grid-cols-4">
          <TabLink
            href="/inbox"
            label={t("tabChats")}
            active={inboxActive}
            icon={MessageSquare}
            badge={totalUnread > 0 && !inboxActive ? totalUnread : 0}
            badgeLabel={t("unreadConversations", { count: totalUnread })}
          />
          <TabLink
            href="/internal-chat"
            label={t("tabInternal")}
            active={internalActive}
            icon={MessagesSquare}
            badge={internalUnread}
            badgeLabel={t("unreadInternal", { count: internalUnread })}
          />
          <TabLink
            href="/notifications"
            label={t("tabNoti")}
            active={notiActive}
            icon={Bell}
            badge={unreadNotifications}
            badgeLabel={t("unreadNotifications", { count: unreadNotifications })}
          />
          <li>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-expanded={profileOpen}
              aria-haspopup="dialog"
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                profileActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <User className="h-5 w-5" />
              {t("tabProfile")}
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-3 text-left">
              <Avatar className="size-10">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold">
                  {profile?.full_name ?? t("defaultUser")}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {profile?.email ?? ""}
                </span>
              </span>
            </SheetTitle>
          </SheetHeader>
          <ul className="flex flex-col p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <li>
              <Link
                href="/settings?tab=profile"
                onClick={() => setProfileOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                <User className="h-4 w-4 text-muted-foreground" />
                {t("menuProfile")}
              </Link>
            </li>
            {extraItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  {t(item.labelKey as string)}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" />
                {t("menuSignOut")}
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TabLink({
  href,
  label,
  active,
  icon: Icon,
  badge,
  badgeLabel,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: typeof MessageSquare;
  badge: number;
  badgeLabel: string;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <span className="relative">
          <Icon className="h-5 w-5" />
          {badge > 0 && (
            <span
              aria-label={badgeLabel}
              className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
            >
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </span>
        {label}
      </Link>
    </li>
  );
}
