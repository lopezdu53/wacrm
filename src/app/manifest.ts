import type { MetadataRoute } from "next";

/**
 * Web app manifest — makes wacrm installable on Android (Chrome
 * "Install app" / Add to Home screen) and iPhone (Safari → Share →
 * Add to Home Screen). Combined with `public/sw.js` this is a PWA:
 * standalone window, home-screen icon, and Web Push for new WhatsApp
 * messages.
 *
 * A sideloaded Android APK (Play Store / PWABuilder Trusted Web
 * Activity) wraps this same origin after HTTPS deploy. iOS cannot
 * sideload an IPA without App Store / TestFlight — Add to Home Screen
 * is the install path there.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "wacrm",
    short_name: "wacrm",
    description: "WhatsApp CRM inbox — chats, contacts, and sales on your phone.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#020617",
    theme_color: "#020617",
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa-icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Inbox",
        short_name: "Inbox",
        url: "/inbox",
        description: "Open the WhatsApp inbox",
      },
      {
        name: "Notifications",
        short_name: "Alerts",
        url: "/notifications",
        description: "New messages and assignments",
      },
    ],
  };
}
