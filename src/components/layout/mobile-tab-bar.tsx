"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, LogOut, MessageSquare, MessagesSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
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
import { BodyPortal } from "@/components/layout/body-portal";
import { BottomDrawer } from "@/components/layout/bottom-drawer";
import { UnreadBadge } from "@/components/layout/unread-badge";

interface MobileTabBarProps {
  hidden?: boolean;
  chatsUnread?: number;
  internalUnread?: number;
  unreadNotifications?: number;
}

const TAB_BAR_HEIGHT =
  "h-[calc(4rem+env(safe-area-inset-bottom,0px))]";

/**
 * WhatsApp Business-style bottom tabs on phones. The four destinations
 * the user asked for: Chats, Interno, Noti, Perfil. Everything else
 * (settings, pipelines, sign out) lives under Perfil.
 *
 * The visible strip is portaled to document.body. A fixed bar inside
 * the dashboard's h-dvh overflow-hidden shell is clipped on phone
 * WebViews — that produced a black hole (#50) and then no menu at all
 * (#51). Body-fixed chrome sits on the visual viewport.
 */
export function MobileTabBar({
  hidden = false,
  chatsUnread = 0,
  internalUnread = 0,
  unreadNotifications = 0,
}: MobileTabBarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname() ?? "";
  const { profile, accountRole, signOut } = useAuth();
  const totalUnread = chatsUnread;
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
  const profileActive = profileOpen || pathname.startsWith("/settings");

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <>
      <TabBarSpacer hidden={hidden} />
      {!hidden && (
        <BodyPortal>
          <nav
            data-mobile-tab-bar=""
            aria-label={t("mobileTabs")}
            className={cn(
              "fixed inset-x-0 bottom-0 z-40 hidden w-full flex-col overflow-visible border-t border-border bg-secondary text-foreground max-lg:flex",
              "pb-[env(safe-area-inset-bottom,0px)]",
            )}
          >
            <ul className="grid h-16 grid-cols-4 overflow-visible">
              <TabLink
                href="/inbox"
                label={t("tabChats")}
                active={inboxActive}
                icon={MessageSquare}
                badge={totalUnread}
              />
              <TabLink
                href="/internal-chat"
                label={t("tabInternal")}
                active={internalActive}
                icon={MessagesSquare}
                badge={internalUnread}
              />
              <TabLink
                href="/notifications"
                label={t("tabNoti")}
                active={notiActive}
                icon={Bell}
                badge={unreadNotifications}
              />
              <li>
                <button
                  type="button"
                  onClick={() => setProfileOpen(true)}
                  aria-expanded={profileOpen}
                  aria-haspopup="dialog"
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    profileActive ? "text-primary" : "text-foreground/70",
                  )}
                >
                  <User className="h-6 w-6" />
                  {t("tabProfile")}
                </button>
              </li>
            </ul>
          </nav>
        </BodyPortal>
      )}

      <BottomDrawer
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title={
          <span className="flex items-center gap-3">
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
          </span>
        }
      >
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
      </BottomDrawer>
    </>
  );
}

/**
 * Hook-free strip so SoftErrorBoundary can still show the four tabs
 * if the live bar throws (i18n / unread / auth).
 */
export function MobileTabBarFallback({
  hidden = false,
  chatsUnread = 0,
  internalUnread = 0,
  unreadNotifications = 0,
}: MobileTabBarProps) {
  if (hidden) return null;

  return (
    <>
      <TabBarSpacer hidden={false} />
      <BodyPortal>
        <nav
          data-mobile-tab-bar=""
          aria-label="Navegación principal"
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 hidden w-full flex-col overflow-visible border-t border-border bg-secondary text-foreground max-lg:flex",
            "pb-[env(safe-area-inset-bottom,0px)]",
          )}
        >
          <ul className="grid h-16 grid-cols-4 overflow-visible">
            <TabLink
              href="/inbox"
              label="Chats"
              active={false}
              icon={MessageSquare}
              badge={chatsUnread}
            />
            <TabLink
              href="/internal-chat"
              label="Interno"
              active={false}
              icon={MessagesSquare}
              badge={internalUnread}
            />
            <TabLink
              href="/notifications"
              label="Noti"
              active={false}
              icon={Bell}
              badge={unreadNotifications}
            />
            <li>
              <Link
                href="/settings"
                className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-foreground/70"
              >
                <User className="h-6 w-6" />
                Perfil
              </Link>
            </li>
          </ul>
        </nav>
      </BodyPortal>
    </>
  );
}

function TabBarSpacer({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none shrink-0 lg:hidden", TAB_BAR_HEIGHT)}
    />
  );
}

function TabLink({
  href,
  label,
  active,
  icon: Icon,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: typeof MessageSquare;
  badge: number;
}) {
  return (
    <li className="min-w-0 overflow-visible">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={
          badge > 0 ? `${label}, ${badge}` : label
        }
        className={cn(
          "flex h-full min-w-0 flex-col items-center justify-center gap-0.5 overflow-visible px-1 text-[11px] font-medium",
          active ? "text-primary" : "text-foreground/70",
        )}
      >
        <span className="flex items-center justify-center gap-0.5 overflow-visible">
          <Icon className="h-6 w-6 shrink-0" />
          <UnreadBadge count={badge} />
        </span>
        <span className="max-w-full truncate">{label}</span>
      </Link>
    </li>
  );
}
