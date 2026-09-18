"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Plain bottom panel. Intentionally not Base UI Dialog/Sheet — those
 * portals have taken down the whole Next.js tree ("This page couldn't
 * load") when mounted from the dashboard shell or the inbox thread.
 *
 * React's createPortal to document.body is fine: the crash was Base UI
 * DialogPortalContext, not portals themselves. Body-mounting keeps the
 * overlay visible when the dashboard shell uses overflow-hidden.
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

  const node = (
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

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
