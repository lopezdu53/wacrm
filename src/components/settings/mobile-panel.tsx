"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  BellOff,
  Check,
  Download,
  Loader2,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsPanelHead } from "./settings-panel-head";
import {
  getDeferredInstallPrompt,
  isAndroidDevice,
  isIosDevice,
  isStandaloneDisplay,
  notificationPermission,
  subscribeInstallPrompt,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pwa/client";

type PushState =
  | "loading"
  | "unsupported"
  | "not_configured"
  | "denied"
  | "off"
  | "on";

export function MobilePanel() {
  const t = useTranslations("Settings.mobile");
  const [standalone, setStandalone] = useState(false);
  const [android, setAndroid] = useState(false);
  const [ios, setIos] = useState(false);
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [pushState, setPushState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);

  const refreshEnv = useCallback(() => {
    setStandalone(isStandaloneDisplay());
    setAndroid(isAndroidDevice());
    setIos(isIosDevice());
    setCanPromptInstall(Boolean(getDeferredInstallPrompt()));
  }, []);

  const refreshPush = useCallback(async () => {
    const perm = notificationPermission();
    if (perm === "unsupported") {
      setPushState("unsupported");
      return;
    }
    if (perm === "denied") {
      setPushState("denied");
      return;
    }
    try {
      const res = await fetch("/api/push/vapid", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        configured?: boolean;
      } | null;
      if (!json?.configured) {
        setPushState("not_configured");
        return;
      }
    } catch {
      setPushState("not_configured");
      return;
    }
    setPushState(perm === "granted" ? "on" : "off");
  }, []);

  useEffect(() => {
    refreshEnv();
    void refreshPush();
    return subscribeInstallPrompt(() => refreshEnv());
  }, [refreshEnv, refreshPush]);

  const handleInstall = async () => {
    const prompt = getDeferredInstallPrompt();
    if (!prompt) return;
    setInstalling(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } finally {
      setInstalling(false);
      refreshEnv();
    }
  };

  const handleEnablePush = async () => {
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (!result.ok && result.error === "not_configured") {
        setPushState("not_configured");
        return;
      }
      if (!result.ok && result.error === "denied") {
        setPushState("denied");
        return;
      }
      if (!result.ok && result.error === "unsupported") {
        setPushState("unsupported");
        return;
      }
      if (result.ok) setPushState("on");
    } finally {
      setBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setPushState("off");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Smartphone className="size-4 text-muted-foreground" />
            {t("installHeading")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {standalone
              ? t("alreadyInstalled")
              : ios
                ? t("iosHint")
                : android
                  ? t("androidHint")
                  : t("desktopHint")}
          </p>

          {canPromptInstall && !standalone ? (
            <Button
              className="mt-4"
              onClick={() => void handleInstall()}
              disabled={installing}
            >
              {installing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {t("installButton")}
            </Button>
          ) : null}

          {standalone ? (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-primary">
              <Check className="size-4" />
              {t("runningStandalone")}
            </p>
          ) : null}

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            {ios ? (
              <>
                <li>{t("iosStep1")}</li>
                <li>{t("iosStep2")}</li>
                <li>{t("iosStep3")}</li>
              </>
            ) : (
              <>
                <li>{t("androidStep1")}</li>
                <li>{t("androidStep2")}</li>
                <li>{t("androidStep3")}</li>
              </>
            )}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{t("apkNote")}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bell className="size-4 text-muted-foreground" />
            {t("pushHeading")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("pushDesc")}</p>

          {ios && !standalone ? (
            <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {t("iosPushRequiresInstall")}
            </p>
          ) : null}

          <div className="mt-4">
            {pushState === "loading" ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : null}
            {pushState === "unsupported" ? (
              <p className="text-sm text-muted-foreground">{t("pushUnsupported")}</p>
            ) : null}
            {pushState === "not_configured" ? (
              <p className="text-sm text-muted-foreground">{t("pushNotConfigured")}</p>
            ) : null}
            {pushState === "denied" ? (
              <p className="text-sm text-muted-foreground">{t("pushDenied")}</p>
            ) : null}
            {pushState === "off" ? (
              <Button onClick={() => void handleEnablePush()} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Bell className="size-4" />
                )}
                {t("enablePush")}
              </Button>
            ) : null}
            {pushState === "on" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex items-center gap-1.5 text-sm text-primary">
                  <Check className="size-4" />
                  {t("pushOn")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDisablePush()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <BellOff className="size-4" />
                  )}
                  {t("disablePush")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
