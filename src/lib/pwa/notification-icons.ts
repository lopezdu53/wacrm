/** Absolute icon URLs — Android leaves a white box when these are relative. */
export function notificationIconUrls(origin: string): {
  icon: string;
  badge: string;
} {
  const base = origin.replace(/\/$/, "");
  return {
    icon: `${base}/pwa-icon/192`,
    badge: `${base}/pwa-icon/badge`,
  };
}
