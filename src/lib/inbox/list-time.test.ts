import { describe, expect, it } from "vitest";

import { formatInboxListTime } from "./list-time";

const labels = { yesterday: "Ayer" };
const now = new Date(2026, 8, 19, 16, 30, 0);

describe("formatInboxListTime", () => {
  it("shows HH:mm for messages from today", () => {
    const today = new Date(2026, 8, 19, 14, 5, 0);
    expect(formatInboxListTime(today.toISOString(), labels, now)).toBe("14:05");
  });

  it("shows the yesterday label", () => {
    const yesterday = new Date(2026, 8, 18, 22, 0, 0);
    expect(formatInboxListTime(yesterday.toISOString(), labels, now)).toBe(
      "Ayer",
    );
  });

  it("shows a short date for older messages", () => {
    const older = new Date(2026, 8, 1, 10, 0, 0);
    expect(formatInboxListTime(older.toISOString(), labels, now)).toBe("1/9/26");
  });

  it("returns empty for missing or invalid timestamps", () => {
    expect(formatInboxListTime(undefined, labels, now)).toBe("");
    expect(formatInboxListTime("not-a-date", labels, now)).toBe("");
  });
});
