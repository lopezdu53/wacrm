"use client";

import { useEffect } from "react";

import {
  captureInstallPrompt,
  registerServiceWorker,
  resubscribeIfGranted,
} from "@/lib/pwa/client";

/**
 * Mounted in the signed-in dashboard shell.
 *
 *  - Listens for Chrome's install prompt so Settings → Mobile can
 *    show "Install app" instead of generic instructions.
 *  - Registers the push-only service worker.
 *  - If the user already granted notifications, refreshes the push
 *    subscription (endpoints rotate).
 */
export function PwaBootstrap() {
  useEffect(() => {
    captureInstallPrompt();
    void registerServiceWorker().then(() => {
      void resubscribeIfGranted();
    });
  }, []);
  return null;
}
