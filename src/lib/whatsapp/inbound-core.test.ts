import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  findExistingContact: vi.fn(),
  runAutomationsForTrigger: vi.fn(() => Promise.resolve()),
  dispatchInboundToFlows: vi.fn(async () => ({ consumed: false })),
  dispatchInboundToAiReply: vi.fn(async () => undefined),
  dispatchInboundToQualify: vi.fn(async () => undefined),
  dispatchWebhookEvent: vi.fn(async () => undefined),
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  updates: [] as { table: string; payload: Record<string, unknown>; id?: string }[],
  messageLookups: [] as Record<string, unknown>[],
  existingDup: null as { id: string } | null,
  replyParent: null as { id: string } | null,
  insertMessageError: null as { code?: string; message?: string } | null,
  conversation: { id: 'conv-1', unread_count: 3 } as {
    id: string;
    unread_count: number;
  },
  priorCustomerCount: 2,
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.findExistingContact,
  isUniqueViolation: (err: { code?: string } | null) => err?.code === '23505',
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}));

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}));

vi.mock('@/lib/ai/qualify', () => ({
  dispatchInboundToQualify: h.dispatchInboundToQualify,
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const state = {
        filters: {} as Record<string, unknown>,
        payload: null as Record<string, unknown> | null,
        op: 'select' as 'select' | 'insert' | 'update',
        countHead: false,
      };

      const builder: Record<string, unknown> = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          state.countHead = Boolean(opts?.head);
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          state.op = 'insert';
          state.payload = payload;
          h.inserts.push({ table, payload });
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          state.op = 'update';
          state.payload = payload;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          state.filters[col] = val;
          return builder;
        },
        is: (col: string, val: unknown) => {
          state.filters[col] = val;
          return builder;
        },
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === 'messages' && state.op === 'select') {
            h.messageLookups.push({ ...state.filters });
            if (
              h.replyParent &&
              state.filters.message_id &&
              state.filters.message_id !== 'wamid-new'
            ) {
              return Promise.resolve({ data: h.replyParent, error: null });
            }
            return Promise.resolve({ data: h.existingDup, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single: () => Promise.resolve({ data: { id: 'new-row' }, error: null }),
        then: (
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => {
          if (table === 'messages' && state.op === 'insert') {
            return Promise.resolve({
              data: h.insertMessageError ? null : { id: 'msg-1' },
              error: h.insertMessageError,
            }).then(onFulfilled, onRejected);
          }
          if (table === 'messages' && state.op === 'select' && state.countHead) {
            return Promise.resolve({
              count: h.priorCustomerCount,
              error: null,
            }).then(onFulfilled, onRejected);
          }
          if (table === 'conversations' && state.op === 'select') {
            return Promise.resolve({
              data: [h.conversation],
              error: null,
            }).then(onFulfilled, onRejected);
          }
          if (table === 'conversations' && state.op === 'update') {
            h.updates.push({
              table,
              payload: state.payload ?? {},
              id: state.filters.id as string | undefined,
            });
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          }
          if (table === 'broadcast_recipients') {
            return Promise.resolve({ data: [], error: null }).then(
              onFulfilled,
              onRejected,
            );
          }
          if (table === 'contacts' && state.op === 'update') {
            return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
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

import {
  normalizeInboundContentType,
  recordInboundMessage,
} from './inbound-core';

const BASE = {
  accountId: 'acct-1',
  configOwnerUserId: 'user-1',
  senderPhone: '573001112233',
  contactName: 'Ada',
  contentText: 'hello',
  mediaUrl: null as string | null,
  contentType: 'text',
  messageId: 'wamid-new',
  timestampMs: 1_700_000_000_000,
  whatsappConfigId: 'cfg-1',
};

beforeEach(() => {
  h.findExistingContact.mockResolvedValue({
    id: 'contact-1',
    name: 'Ada',
    phone: '573001112233',
  });
  h.runAutomationsForTrigger.mockClear();
  h.dispatchInboundToFlows.mockClear().mockResolvedValue({ consumed: false });
  h.dispatchInboundToAiReply.mockClear();
  h.dispatchInboundToQualify.mockClear();
  h.dispatchWebhookEvent.mockClear();
  h.inserts = [];
  h.updates = [];
  h.messageLookups = [];
  h.existingDup = null;
  h.replyParent = null;
  h.insertMessageError = null;
  h.priorCustomerCount = 2;
  h.conversation = { id: 'conv-1', unread_count: 3 };
});

describe('normalizeInboundContentType', () => {
  it('keeps allowed types and maps stickers to image', () => {
    expect(normalizeInboundContentType('interactive')).toBe('interactive');
    expect(normalizeInboundContentType('sticker')).toBe('image');
    expect(normalizeInboundContentType('unknown')).toBe('text');
  });
});

describe('recordInboundMessage', () => {
  it('scopes message-id dedup to the conversation', async () => {
    await recordInboundMessage(BASE);
    const dedup = h.messageLookups.find(
      (row) => row.message_id === 'wamid-new' && row.conversation_id === 'conv-1',
    );
    expect(dedup).toBeDefined();
    expect(h.inserts.some((row) => row.table === 'messages')).toBe(true);
  });

  it('skips insert when the same message already exists on this thread', async () => {
    h.existingDup = { id: 'already' };
    await recordInboundMessage(BASE);
    expect(h.inserts.filter((row) => row.table === 'messages')).toHaveLength(0);
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('persists sticker as image and stores reply + interactive columns', async () => {
    h.replyParent = { id: 'internal-parent' };
    await recordInboundMessage({
      ...BASE,
      contentType: 'sticker',
      contentText: 'Yes',
      messageId: 'wamid-new',
      replyToMetaMessageId: 'wamid-parent',
      interactiveReply: { reply_id: 'btn-1', reply_title: 'Yes' },
    });
    const insert = h.inserts.find((row) => row.table === 'messages');
    expect(insert?.payload).toMatchObject({
      conversation_id: 'conv-1',
      content_type: 'image',
      reply_to_message_id: 'internal-parent',
      interactive_reply_id: 'btn-1',
    });
  });

  it('does not auto-reply with AI on an interactive tap', async () => {
    await recordInboundMessage({
      ...BASE,
      contentText: 'Existing customer',
      contentType: 'interactive',
      interactiveReply: { reply_id: 'existing', reply_title: 'Existing customer' },
    });
    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          kind: 'interactive_reply',
          reply_id: 'existing',
        }),
      }),
    );
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
    expect(h.dispatchInboundToQualify).toHaveBeenCalled();
  });

  it('treats a unique-violation insert as already stored', async () => {
    h.insertMessageError = { code: '23505', message: 'duplicate' };
    await recordInboundMessage(BASE);
    expect(h.updates).toHaveLength(0);
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('sends a plain-text inbound through AI when no flow consumed it', async () => {
    await recordInboundMessage(BASE);
    expect(h.dispatchInboundToAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
      }),
    );
  });
});
