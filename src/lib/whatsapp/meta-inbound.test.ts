import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getMediaUrl: vi.fn(async () => 'https://meta.example/media'),
  findOrCreateContact: vi.fn(),
  findOrCreateConversation: vi.fn(),
  recordInboundMessage: vi.fn(async () => undefined),
  dispatchWebhookEvent: vi.fn(async () => undefined),
  reactionWrites: [] as { op: string; payload?: unknown }[],
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: h.getMediaUrl,
}));

vi.mock('@/lib/whatsapp/inbound-core', () => ({
  findOrCreateContact: h.findOrCreateContact,
  findOrCreateConversation: h.findOrCreateConversation,
  recordInboundMessage: h.recordInboundMessage,
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: () => {
          if (table === 'messages' && filters.message_id === 'wamid-target') {
            return Promise.resolve({ data: { id: 'internal-target' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        delete: () => {
          h.reactionWrites.push({ op: 'delete' });
          return builder;
        },
        upsert: (payload: unknown) => {
          h.reactionWrites.push({ op: 'upsert', payload });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  }),
}));

import {
  parseMessageContent,
  processMetaInboundMessage,
} from './meta-inbound';

beforeEach(() => {
  h.getMediaUrl.mockClear();
  h.recordInboundMessage.mockClear();
  h.findOrCreateContact.mockReset().mockResolvedValue({
    contact: { id: 'contact-1', name: 'Ada', phone: '57300' },
    wasCreated: false,
  });
  h.findOrCreateConversation.mockReset().mockResolvedValue({
    conversation: { id: 'conv-1', unread_count: 0 },
    created: false,
  });
  h.dispatchWebhookEvent.mockClear();
  h.reactionWrites = [];
});

describe('parseMessageContent', () => {
  it('maps a button tap to interactiveReplyId', async () => {
    const parsed = await parseMessageContent(
      {
        id: 'wamid-1',
        from: '573001112233',
        timestamp: '1700000000',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'opt-a', title: 'Option A' },
        },
      },
      'tok',
    );
    expect(parsed.contentText).toBe('Option A');
    expect(parsed.interactiveReplyId).toBe('opt-a');
  });
});

describe('processMetaInboundMessage', () => {
  it('records a text inbound through inbound-core', async () => {
    await processMetaInboundMessage({
      message: {
        id: 'wamid-1',
        from: '573001112233',
        timestamp: '1700000000',
        type: 'text',
        text: { body: 'hola' },
        context: { id: 'wamid-parent' },
      },
      contact: { profile: { name: 'Ada' }, wa_id: '573001112233' },
      accountId: 'acct-1',
      configOwnerUserId: 'user-1',
      accessToken: 'tok',
      whatsappConfigId: 'cfg-1',
    });
    expect(h.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        senderPhone: '573001112233',
        contentText: 'hola',
        contentType: 'text',
        messageId: 'wamid-1',
        whatsappConfigId: 'cfg-1',
        replyToMetaMessageId: 'wamid-parent',
      }),
    );
  });

  it('does not insert a message row for reactions', async () => {
    await processMetaInboundMessage({
      message: {
        id: 'wamid-react',
        from: '573001112233',
        timestamp: '1700000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-target', emoji: '👍' },
      },
      contact: { profile: { name: 'Ada' }, wa_id: '573001112233' },
      accountId: 'acct-1',
      configOwnerUserId: 'user-1',
      accessToken: 'tok',
      whatsappConfigId: 'cfg-1',
    });
    expect(h.recordInboundMessage).not.toHaveBeenCalled();
    expect(h.findOrCreateContact).toHaveBeenCalled();
    expect(h.reactionWrites).toEqual([
      expect.objectContaining({
        op: 'upsert',
        payload: expect.objectContaining({
          message_id: 'internal-target',
          emoji: '👍',
        }),
      }),
    ]);
  });
});
