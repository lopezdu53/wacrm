import { describe, expect, it } from "vitest";

import { notificationIconUrls } from "./notification-icons";

describe("notificationIconUrls", () => {
  it("uses absolute paths so Android does not paint a white box", () => {
    expect(notificationIconUrls("https://whatsapp.ventabot.cloud")).toEqual({
      icon: "https://whatsapp.ventabot.cloud/pwa-icon/192",
      badge: "https://whatsapp.ventabot.cloud/pwa-icon/badge",
    });
  });
});
