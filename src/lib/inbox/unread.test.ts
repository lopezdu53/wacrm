import { describe, expect, it } from "vitest";

import { formatUnreadBadge, sumUnread } from "./unread";

describe("sumUnread", () => {
  it("adds message counts, not just how many chats are unread", () => {
    expect(sumUnread([0, 3, 12, 0])).toBe(15);
    expect(sumUnread([])).toBe(0);
  });
});

describe("formatUnreadBadge", () => {
  it("caps at 99+", () => {
    expect(formatUnreadBadge(0)).toBe("");
    expect(formatUnreadBadge(7)).toBe("7");
    expect(formatUnreadBadge(100)).toBe("99+");
  });
});
