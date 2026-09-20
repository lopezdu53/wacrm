"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import {
  MobileTabBar,
  MobileTabBarFallback,
} from "@/components/layout/mobile-tab-bar";
import { SoftErrorBoundary } from "@/components/layout/soft-error-boundary";
import { DashboardNavContext } from "@/components/layout/dashboard-nav-context";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { PwaBootstrap } from "@/components/pwa/pwa-bootstrap";
import { useInternalUnread } from "@/hooks/use-internal-unread";
import { useLaneUnread } from "@/hooks/use-lane-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { cn } from "@/lib/utils";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const isInbox = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const isOpportunities =
    pathname === "/opportunities" || pathname.startsWith("/opportunities/");
  const isChatLane = isInbox || isOpportunities;
  const isInternalChat = pathname.startsWith("/internal-chat");
  const hideMobileHeader = isChatLane || isInternalChat;

  // Full-screen chats hide the WhatsApp-style bottom tabs.
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [viewingConversationId, setViewingConversationId] = useState<
    string | null
  >(null);
  const [viewingInternalChannelId, setViewingInternalChannelId] = useState<
    string | null
  >(null);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [oppUnread, setOppUnread] = useState(0);
  const hookedLanes = useLaneUnread(user?.id);
  const internalUnread = useInternalUnread(user?.id);
  const notificationUnread = useUnreadNotifications(user?.id);
  const chatsUnread = Math.max(hookedLanes.inbox, inboxUnread);
  const opportunitiesUnread = Math.max(hookedLanes.opportunity, oppUnread);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <DashboardNavContext.Provider
      value={{
        setMobileChatOpen,
        viewingConversationId,
        setViewingConversationId,
        viewingInternalChannelId,
        setViewingInternalChannelId,
        inboxUnread,
        setInboxUnread,
        oppUnread,
        setOppUnread,
        chatsUnread,
        internalUnread,
        notificationUnread,
      }}
    >
      <div className="flex h-dvh overflow-hidden bg-background">
        <PresenceHeartbeat />
        <PwaBootstrap />
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Header className={hideMobileHeader ? "max-lg:hidden" : undefined} />
          <main
            className={cn(
              "min-h-0 flex-1",
              isChatLane
                ? "overflow-hidden p-0"
                : isInternalChat
                  ? "overflow-hidden max-lg:p-0 p-4 sm:p-6"
                  : "overflow-y-auto p-4 sm:p-6",
            )}
          >
            {children}
          </main>
          <SoftErrorBoundary
            fallback={
              <MobileTabBarFallback
                hidden={mobileChatOpen}
                chatsUnread={chatsUnread}
                oppUnread={opportunitiesUnread}
                internalUnread={internalUnread}
                unreadNotifications={notificationUnread}
              />
            }
          >
            <MobileTabBar
              hidden={mobileChatOpen}
              chatsUnread={chatsUnread}
              oppUnread={opportunitiesUnread}
              internalUnread={internalUnread}
              unreadNotifications={notificationUnread}
            />
          </SoftErrorBoundary>
        </div>
      </div>
    </DashboardNavContext.Provider>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
