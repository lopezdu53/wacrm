import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  APP_NAV_ITEMS,
  MOBILE_TAB_HREFS,
  SETTINGS_NAV_ITEM,
} from "./nav-items";

describe("mobile tab destinations", () => {
  it("pins Chats, Interno, and Noti as the three link tabs", () => {
    expect([...MOBILE_TAB_HREFS]).toEqual([
      "/inbox",
      "/internal-chat",
      "/notifications",
    ]);
  });

  it("keeps remaining CRM pages under Perfil instead of the tab strip", () => {
    const tabSet = new Set<string>(MOBILE_TAB_HREFS);
    const extra = APP_NAV_ITEMS.filter((item) => !tabSet.has(item.href)).map(
      (item) => item.href,
    );
    expect(extra).toContain("/dashboard");
    expect(extra).toContain("/contacts");
    expect(extra).not.toContain("/inbox");
    expect(SETTINGS_NAV_ITEM.href).toBe("/settings");
  });
});

describe("inbox thread overflow menu", () => {
  it("does not nest DropdownMenuSub (that crashed the phone PWA)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/inbox/message-thread.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/DropdownMenuSub/);
    expect(src).toMatch(/toolsOpen/);
    expect(src).toMatch(/setToolsOpen\(true\)/);
  });
});
