"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Mount children on document.body after hydration. Use this for phone
 * chrome that must stay on the visual viewport — `position:fixed`
 * inside the dashboard's overflow-hidden shell is clipped.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
