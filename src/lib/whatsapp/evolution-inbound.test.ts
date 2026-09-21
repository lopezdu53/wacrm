import { describe, expect, it } from 'vitest';

import {
  extractContextStanzaId,
  parseBaileys,
  phoneFromJid,
  resolveEvolutionSenderPhone,
  unwrapBaileysMessage,
} from './evolution-inbound';
import {
  mediaBase64FromEvolutionJson,
  stripMediaDataUrl,
} from './evolution-api';

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

  it('unwraps WhatsApp Web videos inside ephemeralMessage', () => {
    const parsed = parseBaileys({
      ephemeralMessage: {
        message: {
          videoMessage: {
            mimetype: 'video/mp4',
            seconds: 136,
            caption: 'Precio de esta máquina',
          },
        },
      },
    });
    expect(parsed.contentType).toBe('video');
    expect(parsed.mediaKey).toBe('videoMessage');
    expect(parsed.text).toBe('Precio de esta máquina');
  });

  it('maps PTV video notes to video', () => {
    const parsed = parseBaileys({
      ptvMessage: { mimetype: 'video/mp4', seconds: 8 },
    });
    expect(parsed.contentType).toBe('video');
    expect(parsed.mediaKey).toBe('videoMessage');
  });

  it('does not treat an empty conversation string as the whole message', () => {
    const parsed = parseBaileys({
      conversation: '',
      videoMessage: { mimetype: 'video/mp4' },
    });
    expect(parsed.contentType).toBe('video');
  });

  it('uses Evolution messageType when the body is an empty envelope', () => {
    const parsed = parseBaileys({}, 'videoMessage');
    expect(parsed.contentType).toBe('video');
    expect(parsed.mediaKey).toBe('videoMessage');
  });
});

describe('unwrapBaileysMessage', () => {
  it('walks viewOnceMessageV2', () => {
    const inner = unwrapBaileysMessage({
      viewOnceMessageV2: {
        message: { videoMessage: { mimetype: 'video/mp4' } },
      },
    });
    expect(inner?.videoMessage).toEqual({ mimetype: 'video/mp4' });
  });
});

describe('stripMediaDataUrl', () => {
  it('strips a data URL prefix', () => {
    expect(stripMediaDataUrl('data:video/mp4;base64,AAAA')).toBe('AAAA');
    expect(mediaBase64FromEvolutionJson({ base64: 'data:video/mp4;base64,QQ==' })).toBe(
      'QQ==',
    );
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

  it('skips groups and bare LIDs as phones', () => {
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

  it('does not treat @username JIDs as phone digits', () => {
    expect(phoneFromJid('yel_cac@s.whatsapp.net')).toBeNull();
    expect(phoneFromJid('1E4NDRA@s.whatsapp.net')).toBeNull();
    expect(
      resolveEvolutionSenderPhone({
        key: { remoteJid: '1E4NDRA@s.whatsapp.net', id: 'm1' },
      }),
    ).toBeNull();
  });
});
