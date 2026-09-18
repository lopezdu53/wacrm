import { describe, expect, it } from "vitest";

import {
  previewInboundBody,
  resolveNewMessageRecipients,
  shouldDropPushSubscription,
} from "./recipients";
import { isPushEndpointUrl, parsePushSubscriptionBody } from "./subscription";
import { getVapidConfig, isVapidConfigured } from "./vapid";

describe("resolveNewMessageRecipients", () => {
  const members = [
    { user_id: "owner-1", account_role: "owner", restrict_to_assigned: false },
    { user_id: "agent-1", account_role: "agent", restrict_to_assigned: false },
    { user_id: "agent-restricted", account_role: "agent", restrict_to_assigned: true },
    { user_id: "viewer-1", account_role: "viewer", restrict_to_assigned: false },
  ];

  it("notifies the assignee and followers on an assigned thread", () => {
    expect(
      resolveNewMessageRecipients({
        assignedAgentId: "agent-restricted",
        followerIds: ["follower-1", "agent-restricted"],
        members,
      }).sort(),
    ).toEqual(["agent-restricted", "follower-1"]);
  });

  it("notifies unassigned agents/admins/owners, never viewers or restricted", () => {
    expect(
      resolveNewMessageRecipients({
        assignedAgentId: null,
        followerIds: ["follower-1"],
        members,
      }).sort(),
    ).toEqual(["agent-1", "follower-1", "owner-1"]);
  });
});

describe("previewInboundBody", () => {
  it("truncates long text and maps media types", () => {
    expect(previewInboundBody("hello", "text")).toBe("hello");
    expect(previewInboundBody("x".repeat(200), "text").endsWith("…")).toBe(true);
    expect(previewInboundBody("", "image")).toBe("Sent a photo");
    expect(previewInboundBody(null, "audio")).toBe("Sent a voice note");
  });
});

describe("shouldDropPushSubscription", () => {
  it("drops gone endpoints only", () => {
    expect(shouldDropPushSubscription(410)).toBe(true);
    expect(shouldDropPushSubscription(404)).toBe(true);
    expect(shouldDropPushSubscription(500)).toBe(false);
    expect(shouldDropPushSubscription(undefined)).toBe(false);
  });
});

describe("isPushEndpointUrl", () => {
  it("accepts https public hosts and rejects private/loopback", () => {
    expect(isPushEndpointUrl("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpointUrl("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpointUrl("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpointUrl("https://127.0.0.1/push")).toBe(false);
    expect(isPushEndpointUrl("https://localhost/push")).toBe(false);
    expect(isPushEndpointUrl("not a url")).toBe(false);
  });
});

describe("parsePushSubscriptionBody", () => {
  it("reads nested keys from a PushSubscription.toJSON() payload", () => {
    expect(
      parsePushSubscriptionBody({
        endpoint: "https://fcm.googleapis.com/fcm/send/token",
        keys: { p256dh: "abc", auth: "def" },
      }),
    ).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/token",
      p256dh: "abc",
      auth: "def",
    });
  });

  it("rejects missing keys", () => {
    expect(
      parsePushSubscriptionBody({
        endpoint: "https://fcm.googleapis.com/fcm/send/token",
        keys: { p256dh: "abc" },
      }),
    ).toBeNull();
  });
});

describe("getVapidConfig", () => {
  const snapshot = () => ({
    pub: process.env.VAPID_PUBLIC_KEY,
    priv: process.env.VAPID_PRIVATE_KEY,
    sub: process.env.VAPID_SUBJECT,
    site: process.env.NEXT_PUBLIC_SITE_URL,
  });

  const restore = (prev: ReturnType<typeof snapshot>) => {
    const apply = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    apply("VAPID_PUBLIC_KEY", prev.pub);
    apply("VAPID_PRIVATE_KEY", prev.priv);
    apply("VAPID_SUBJECT", prev.sub);
    apply("NEXT_PUBLIC_SITE_URL", prev.site);
  };

  it("returns null when keys are missing", () => {
    const prev = snapshot();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(isVapidConfigured()).toBe(false);
    expect(getVapidConfig()).toBeNull();
    restore(prev);
  });

  it("reads keys and falls back to the site URL as subject", () => {
    const prev = snapshot();
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    delete process.env.VAPID_SUBJECT;
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.example.com";
    expect(getVapidConfig()).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "https://crm.example.com",
    });
    restore(prev);
  });
});
