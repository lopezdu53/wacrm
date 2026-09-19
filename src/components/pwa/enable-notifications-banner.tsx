"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";

import {
  notificationPermission,
  subscribeToPush,
} from "@/lib/pwa/client";
import { BodyPortal } from "@/components/layout/body-portal";

/**
 * WhatsApp-style prompt on the phone. Permission must come from a
 * tap — browsers ignore requestPermission() on first paint. After
 * grant we also try Web Push (background alerts when VAPID is set).
 */
export function EnableNotificationsBanner() {
  const t = useTranslations("Settings.mobile");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setVisible(false);
      return;
    }
    const perm = notificationPermission();
    setVisible(perm === "default");
  }, []);

  useEffect(() => {
    refresh();
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => refresh();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [refresh]);

  if (!visible) return null;

  return (
    <BodyPortal>
      <div className="pointer-events-auto fixed inset-x-0 top-0 z-50 border-b border-border bg-secondary px-3 py-2 text-foreground lg:hidden">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm leading-snug">{t("bannerBody")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void subscribeToPush()
                .catch(() => undefined)
                .finally(() => {
                  setBusy(false);
                  refresh();
                });
            }}
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            {t("bannerAction")}
          </button>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {t("bannerDismiss")}
          </button>
        </div>
      </div>
    </BodyPortal>
  );
}
