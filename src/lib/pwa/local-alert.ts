/**
 * Phone-tray + sound helpers used while the PWA is open.
 *
 * Web Push (sw.js) covers the killed-app case. This path covers the
 * much more common case: the agent is looking at Chats and a customer
 * writes. Same tag as the server push so the OS replaces, not stacks.
 */

export function conversationAlertTag(conversationId: string): string {
  return `conv:${conversationId}`;
}

export function internalAlertTag(channelId: string): string {
  return `internal:${channelId}`;
}

export function shouldSuppressAlert(args: {
  tag: string;
  viewingConversationId?: string | null;
  viewingInternalChannelId?: string | null;
}): boolean {
  const conv = args.viewingConversationId?.trim();
  if (conv && args.tag === conversationAlertTag(conv)) return true;
  const channel = args.viewingInternalChannelId?.trim();
  if (channel && args.tag === internalAlertTag(channel)) return true;
  return false;
}

const recent = new Map<string, number>();
const DEDUPE_MS = 2000;

export function resetAlertDedupe(): void {
  recent.clear();
}

/** Returns true when this tag has not fired in the last 2s. */
export function markAlertEmitted(tag: string, now = Date.now()): boolean {
  const prev = recent.get(tag);
  if (prev !== undefined && now - prev < DEDUPE_MS) return false;
  recent.set(tag, now);
  return true;
}

export function playNotificationSound(): void {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const beep = (when: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.12, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.16);
    };
    const t = ctx.currentTime;
    beep(t, 880);
    beep(t + 0.16, 1175);
    void ctx.resume();
  } catch {
    /* autoplay / missing AudioContext — OS sound still applies */
  }
}

export async function emitLocalAlert(args: {
  title: string;
  body: string;
  url: string;
  tag: string;
}): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission !== "granted") return false;
  if (!markAlertEmitted(args.tag)) return false;

  playNotificationSound();
  try {
    navigator.vibrate?.([80, 40, 120]);
  } catch {
    /* vibrate is optional */
  }

  const options = {
    body: args.body,
    icon: "/pwa-icon/192",
    badge: "/pwa-icon/192",
    tag: args.tag,
    renotify: true,
    silent: false,
    vibrate: [80, 40, 120],
    data: { url: args.url },
  } as NotificationOptions;

  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) {
      await reg.showNotification(args.title, options);
      return true;
    }
  } catch {
    /* fall through to the page Notification constructor */
  }

  try {
    new Notification(args.title, options);
    return true;
  } catch {
    return false;
  }
}
