import { describe, expect, it } from 'vitest';

import {
  extractContextStanzaId,
  parseBaileys,
  phoneFromJid,
  resolveEvolutionSenderPhone,
} from './evolution-inbound';

describe('extractContextStanzaId', () => {
  it('reads stanzaId off extendedTextMessage.contextInfo', () => {
    expect(
      extractContextStanzaId({
        extendedTextMessage: {
          text: 'hi',
          contextInfo: { stanzaId: 'ABC123' },
        },
      }),
    ).toBe('ABC123');
  });
});

describe('parseBaileys', () => {
  it('maps stickers and quoted replies', () => {
    const parsed = parseBaileys({
      stickerMessage: {
        mimetype: 'image/webp',
        contextInfo: { stanzaId: 'quoted-1' },
      },
    });
    expect(parsed.contentType).toBe('sticker');
    expect(parsed.mediaKey).toBe('stickerMessage');
    expect(parsed.replyToMetaMessageId).toBe('quoted-1');
  });

  it('keeps button replies interactive', () => {
    const parsed = parseBaileys({
      buttonsResponseMessage: {
        selectedButtonId: 'btn-1',
        selectedDisplayText: 'Yes',
      },
    });
    expect(parsed.contentType).toBe('interactive');
    expect(parsed.interactiveReply).toEqual({
      reply_id: 'btn-1',
      reply_title: 'Yes',
    });
  });
});

describe('resolveEvolutionSenderPhone', () => {
  it('resolves a phone from LID + remoteJidAlt', () => {
    expect(
      resolveEvolutionSenderPhone({
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '573001112233@s.whatsapp.net',
          id: 'm1',
        },
      }),
    ).toBe('573001112233');
  });

  it('accepts a bare phone sender and rejects instance names', () => {
    expect(phoneFromJid('573001112233')).toBe('573001112233');
    expect(phoneFromJid('ventas')).toBeNull();
  });

  it('skips groups and bare LIDs', () => {
    expect(
      resolveEvolutionSenderPhone({
        key: { remoteJid: '120363@g.us', id: 'm1' },
      }),
    ).toBeNull();
    expect(
      resolveEvolutionSenderPhone({
        key: { remoteJid: '123456789012345@lid', id: 'm1' },
      }),
    ).toBeNull();
  });
});
