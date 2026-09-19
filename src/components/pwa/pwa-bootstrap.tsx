"use client";

import { useEffect } from "react";

import {
  captureInstallPrompt,
  registerServiceWorker,
  resubscribeIfGranted,
} from "@/lib/pwa/client";
import { EnableNotificationsBanner } from "@/components/pwa/enable-notifications-banner";
import { IncomingAlerts } from "@/components/pwa/incoming-alerts";

/**
 * Mounted in the signed-in dashboard shell.
 *
 *  - Listens for Chrome's install prompt so Settings → Mobile can
 *    show "Install app" instead of generic instructions.
 *  - Registers the push-only service worker.
 *  - If the user already granted notifications, refreshes the push
 *    subscription (endpoints rotate).
 *  - Asks on the phone (banner) and plays tray alerts while open.
 */
export function PwaBootstrap() {
  useEffect(() => {
    captureInstallPrompt();
    void registerServiceWorker().then(() => {
      void resubscribeIfGranted();
    });
  }, []);
  return (
    <>
      <EnableNotificationsBanner />
      <IncomingAlerts />
    </>
  );
}
