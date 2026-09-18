"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { DashboardNavContext } from "@/components/layout/dashboard-nav-context";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { PwaBootstrap } from "@/components/pwa/pwa-bootstrap";
import { cn } from "@/lib/utils";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isInbox = pathname === "/inbox";
  const isInternalChat = pathname.startsWith("/internal-chat");
  const hideMobileHeader = isInbox || isInternalChat;

  // Full-screen chats hide the WhatsApp-style bottom tabs.
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

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
    <DashboardNavContext.Provider value={{ setMobileChatOpen }}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <PresenceHeartbeat />
        <PwaBootstrap />
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Header className={hideMobileHeader ? "max-lg:hidden" : undefined} />
          <main
            className={cn(
              "min-h-0 flex-1",
              isInbox
                ? "overflow-hidden p-0"
                : isInternalChat
                  ? "overflow-hidden max-lg:p-0 p-4 sm:p-6"
                  : "overflow-y-auto p-4 sm:p-6",
              !mobileChatOpen &&
                "max-lg:pb-[calc(3.5rem+env(safe-area-inset-bottom))]",
            )}
          >
            {children}
          </main>
        </div>
        <MobileTabBar hidden={mobileChatOpen} />
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
