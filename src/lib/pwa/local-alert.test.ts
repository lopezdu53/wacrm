import { describe, expect, it } from "vitest";

import {
  conversationAlertTag,
  internalAlertTag,
  markAlertEmitted,
  resetAlertDedupe,
  shouldSuppressAlert,
} from "./local-alert";

describe("local alert tags", () => {
  it("matches the Web Push conversation tag so the OS replaces, not stacks", () => {
    expect(conversationAlertTag("abc")).toBe("conv:abc");
    expect(internalAlertTag("ch-1")).toBe("internal:ch-1");
  });

  it("stays quiet when that WhatsApp or internal thread is already open", () => {
    expect(
      shouldSuppressAlert({
        tag: "conv:c1",
        viewingConversationId: "c1",
      }),
    ).toBe(true);
    expect(
      shouldSuppressAlert({
        tag: "internal:ch",
        viewingInternalChannelId: "ch",
      }),
    ).toBe(true);
    expect(
      shouldSuppressAlert({
        tag: "conv:c1",
        viewingConversationId: "other",
      }),
    ).toBe(false);
  });

  it("dedupes the same tag for two seconds", () => {
    resetAlertDedupe();
    expect(markAlertEmitted("conv:x", 1_000)).toBe(true);
    expect(markAlertEmitted("conv:x", 1_500)).toBe(false);
    expect(markAlertEmitted("conv:x", 3_100)).toBe(true);
    expect(markAlertEmitted("conv:y", 3_100)).toBe(true);
  });
});
