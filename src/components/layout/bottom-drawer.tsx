"use client";

import type { ReactNode } from "react";

/**
 * Plain bottom panel. Intentionally not Base UI Dialog/Sheet — those
 * portals have taken down the whole Next.js tree ("This page couldn't
 * load") when mounted from the dashboard shell or the inbox thread.
 */
export function BottomDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-background/70"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-popover text-popover-foreground shadow-lg">
        <div className="border-b border-border px-4 py-3 text-left text-base font-medium">
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
