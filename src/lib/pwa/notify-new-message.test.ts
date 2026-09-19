import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  deletes: [] as { table: string; id?: string }[],
  followers: [] as { user_id: string }[],
  members: [] as {
    user_id: string;
    account_role: string;
    restrict_to_assigned: boolean;
  }[],
  existingNotification: null as { id: string } | null,
  subscriptions: [] as {
    id: string;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[],
  sendNotification: vi.fn(async () => undefined),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: h.setVapidDetails,
    sendNotification: h.sendNotification,
    generateVAPIDKeys: () => ({ publicKey: "gen-pub", privateKey: "gen-priv" }),
  },
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const state = {
        filters: {} as Record<string, unknown>,
        payload: null as Record<string, unknown> | null,
        op: "select" as "select" | "insert" | "update" | "delete",
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: Record<string, unknown>) => {
          state.op = "insert";
          state.payload = payload;
          h.inserts.push({ table, payload });
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = "update";
          state.payload = payload;
          h.updates.push({ table, payload });
          return builder;
        },
        delete: () => {
          state.op = "delete";
          return builder;
        },
        eq: (col: string, val: unknown) => {
          state.filters[col] = val;
          if (state.op === "delete" && col === "id") {
            h.deletes.push({ table, id: val as string });
          }
          return builder;
        },
        is: (col: string, val: unknown) => {
          state.filters[col] = val;
          return builder;
        },
        in: (col: string, val: unknown) => {
          state.filters[col] = val;
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => {
          if (table === "notifications" && state.op === "select") {
            return Promise.resolve({ data: h.existingNotification, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => {
          if (table === "conversation_followers") {
            return Promise.resolve({ data: h.followers, error: null }).then(
              onFulfilled,
              onRejected,
            );
          }
          if (table === "profiles") {
            return Promise.resolve({ data: h.members, error: null }).then(
              onFulfilled,
              onRejected,
            );
          }
          if (table === "push_subscriptions" && state.op === "select") {
            return Promise.resolve({ data: h.subscriptions, error: null }).then(
              onFulfilled,
              onRejected,
            );
          }
          return Promise.resolve({ data: null, error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };
      return builder;
    },
  }),
}));

import { notifyNewInboundMessage } from "./notify-new-message";

beforeEach(() => {
  h.inserts = [];
  h.updates = [];
  h.deletes = [];
  h.followers = [];
  h.existingNotification = null;
  h.subscriptions = [];
  h.sendNotification.mockClear().mockResolvedValue(undefined);
  h.setVapidDetails.mockClear();
  h.members = [
    { user_id: "agent-1", account_role: "agent", restrict_to_assigned: false },
    { user_id: "viewer-1", account_role: "viewer", restrict_to_assigned: false },
  ];
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:ops@example.com";
});

describe("notifyNewInboundMessage", () => {
  it("inserts an in-app notification and sends push to unassigned agents", async () => {
    h.subscriptions = [
      {
        id: "sub-1",
        user_id: "agent-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        p256dh: "p",
        auth: "a",
      },
    ];

    await notifyNewInboundMessage({
      accountId: "acct-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      contactName: "Ada",
      contentText: "hello there",
      contentType: "text",
      assignedAgentId: null,
    });

    const note = h.inserts.find((row) => row.table === "notifications");
    expect(note?.payload).toMatchObject({
      user_id: "agent-1",
      type: "new_message",
      conversation_id: "conv-1",
      title: "Ada",
      body: "hello there",
    });
    expect(h.inserts.some((row) => row.payload.user_id === "viewer-1")).toBe(
      false,
    );
    expect(h.sendNotification).toHaveBeenCalledTimes(1);
    const sentArgs = h.sendNotification.mock.calls[0] as unknown as [
      { endpoint: string },
      string,
    ];
    const payload = JSON.parse(sentArgs[1]) as {
      url: string;
      tag: string;
    };
    expect(payload.url).toBe("/inbox?c=conv-1");
    expect(payload.tag).toBe("conv:conv-1");
  });

  it("updates an existing unread new_message instead of inserting another", async () => {
    h.existingNotification = { id: "note-1" };
    await notifyNewInboundMessage({
      accountId: "acct-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      contactName: "Ada",
      contentText: "second",
      contentType: "text",
      assignedAgentId: "agent-1",
    });
    expect(h.inserts.filter((row) => row.table === "notifications")).toHaveLength(
      0,
    );
    expect(h.updates.some((row) => row.payload.body === "second")).toBe(true);
  });

  it("drops a gone push endpoint", async () => {
    h.subscriptions = [
      {
        id: "sub-gone",
        user_id: "agent-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/old",
        p256dh: "p",
        auth: "a",
      },
    ];
    h.sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    await notifyNewInboundMessage({
      accountId: "acct-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      contactName: "Ada",
      contentText: "hi",
      contentType: "text",
      assignedAgentId: "agent-1",
    });
    expect(h.deletes).toEqual([{ table: "push_subscriptions", id: "sub-gone" }]);
  });
});
