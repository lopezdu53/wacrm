"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
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

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);

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
    <DashboardNavContext.Provider value={{ openSidebar }}>
      <div className="flex h-dvh overflow-hidden bg-background">
        {/* Reports this tab's online/away presence once we know a user is
            signed in. Headless — renders nothing. */}
        <PresenceHeartbeat />
        <PwaBootstrap />
        <Sidebar open={sidebarOpen} onClose={closeSidebar} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Inbox on a phone is full-screen like WhatsApp Business — the
              list and thread draw their own chrome (hamburger / back). */}
          <Header
            onOpenSidebar={openSidebar}
            className={isInbox ? "max-lg:hidden" : undefined}
          />
          <main
            className={cn(
              "min-h-0 flex-1",
              isInbox
                ? "overflow-hidden p-0"
                : "overflow-y-auto p-4 sm:p-6",
            )}
          >
            {children}
          </main>
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
