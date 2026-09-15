import { describe, expect, it } from 'vitest';

import {
  contactKeyToRemoteJid,
  resolveEvolutionPeer,
  resolveOutboundRecipient,
  toEvolutionRecipient,
} from './peer-identity';

describe('resolveEvolutionPeer', () => {
  it('prefers a real phone on remoteJidAlt over a LID', () => {
    expect(
      resolveEvolutionPeer({
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '573001112233@s.whatsapp.net',
        },
      }),
    ).toEqual({
      contactKey: '573001112233',
      phone: '573001112233',
      lid: '123456789012345',
      username: null,
    });
  });

  it('keeps @username chats on user: keys, not stripped digits', () => {
    expect(
      resolveEvolutionPeer({
        key: { remoteJid: '1E4NDRA@s.whatsapp.net', id: 'm1' },
      }),
    ).toEqual({
      contactKey: 'user:1e4ndra',
      phone: null,
      lid: null,
      username: '1e4ndra',
    });
    expect(
      resolveEvolutionPeer({
        key: { remoteJid: 'yel_cac@s.whatsapp.net', id: 'm1' },
      }),
    ).toMatchObject({ contactKey: 'user:yel_cac', username: 'yel_cac' });
  });

  it('uses remoteJidUsername when the chat is LID-only', () => {
    expect(
      resolveEvolutionPeer({
        key: {
          remoteJid: '999888777666555@lid',
          remoteJidUsername: 'yel_cac',
        },
      }),
    ).toEqual({
      contactKey: 'user:yel_cac',
      phone: null,
      lid: '999888777666555',
      username: 'yel_cac',
    });
  });

  it('falls back to lid:{id} when there is no phone and no username', () => {
    expect(
      resolveEvolutionPeer({
        key: { remoteJid: '123456789012345@lid', id: 'm1' },
      }),
    ).toEqual({
      contactKey: 'lid:123456789012345',
      phone: null,
      lid: '123456789012345',
      username: null,
    });
  });

  it('skips groups and instance names', () => {
    expect(
      resolveEvolutionPeer({ key: { remoteJid: '120363@g.us' } }),
    ).toBeNull();
    expect(resolveEvolutionPeer({ key: { remoteJid: 'ventas' } })).toBeNull();
  });

  it('does not treat two different usernames as one peer', () => {
    const a = resolveEvolutionPeer({
      key: { remoteJid: '1E4NDRA@s.whatsapp.net' },
    });
    const b = resolveEvolutionPeer({
      key: { remoteJid: 'yel_cac@s.whatsapp.net' },
    });
    expect(a?.contactKey).not.toBe(b?.contactKey);
  });
});

describe('toEvolutionRecipient', () => {
  it('sends usernames and LIDs without stripping letters', () => {
    expect(toEvolutionRecipient('user:yel_cac')).toBe('yel_cac');
    expect(toEvolutionRecipient('1E4NDRA')).toBe('1e4ndra');
    expect(toEvolutionRecipient('lid:123456789012345')).toBe(
      '123456789012345@lid',
    );
    expect(toEvolutionRecipient('573001112233')).toBe('573001112233');
  });

  it('does not turn 1E4NDRA into 14', () => {
    expect(toEvolutionRecipient('user:1e4ndra')).toBe('1e4ndra');
    expect(toEvolutionRecipient('@1E4NDRA')).toBe('1e4ndra');
  });
});

describe('contactKeyToRemoteJid', () => {
  it('builds a JID Evolution can look up', () => {
    expect(contactKeyToRemoteJid('573001112233')).toBe(
      '573001112233@s.whatsapp.net',
    );
    expect(contactKeyToRemoteJid('user:yel_cac')).toBe(
      'yel_cac@s.whatsapp.net',
    );
    expect(contactKeyToRemoteJid('lid:12345')).toBe('12345@lid');
  });
});

describe('resolveOutboundRecipient', () => {
  it('rejects @username on Meta and allows it on Evolution', () => {
    expect(resolveOutboundRecipient('user:yel_cac', false).ok).toBe(false);
    expect(resolveOutboundRecipient('user:yel_cac', true)).toEqual({
      ok: true,
      variants: ['yel_cac'],
      baseline: 'user:yel_cac',
      isHandle: true,
    });
  });

  it('keeps E.164 phones', () => {
    const r = resolveOutboundRecipient('+57 300 111 2233', true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.variants).toEqual(['573001112233']);
      expect(r.isHandle).toBe(false);
    }
  });
});
