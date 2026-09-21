import { describe, expect, it } from 'vitest';

import {
  isContactOnPayload,
  isProvenPeerPair,
  listComplementaryNameTwinPairs,
  listSharedProviderMessagePairs,
  listStampedLidPairs,
  pickComplementaryNameTwin,
  pickSurvivorContact,
  preferE164ContactPhone,
  selectMergeableLosers,
} from './merge-peer';

describe('preferE164ContactPhone', () => {
  it('promotes a stored LID key to the known E.164', () => {
    expect(preferE164ContactPhone('lid:244327888465593', '573112423412')).toBe(
      '573112423412',
    );
    expect(preferE164ContactPhone('573112423412', 'lid:244327888465593')).toBe(
      null,
    );
    expect(preferE164ContactPhone('573112423412', '573112423412')).toBe(null);
  });
});

describe('pickSurvivorContact', () => {
  it('prefers the E.164 contact so the LID row can stamp whatsapp_lid on it', () => {
    const phone = { id: 'p', phone: '573131423412' };
    const lid = { id: 'l', phone: 'lid:66244327888465593' };
    expect(pickSurvivorContact([phone, lid], 'lid:66244327888465593').id).toBe(
      'p',
    );
    expect(pickSurvivorContact([lid, phone], '573131423412').id).toBe('p');
  });

  it('falls back to the preferred handle when there is no E.164', () => {
    const user = { id: 'u', phone: 'user:edwinvargas21' };
    const lid = { id: 'l', phone: 'lid:6611235915522259' };
    expect(pickSurvivorContact([user, lid], 'user:edwinvargas21').id).toBe('u');
  });
});

describe('isContactOnPayload', () => {
  it('keeps a merged E.164 row when a later inbound is LID-only', () => {
    expect(
      isContactOnPayload(
        { id: 'balon', phone: '573008579176', whatsapp_lid: '244327888465953' },
        ['lid:244327888465953'],
      ),
    ).toBe(true);
  });

  it('does not treat a different LID as the stamped phone row', () => {
    expect(
      isContactOnPayload(
        { id: 'mega', phone: '573023582969', whatsapp_lid: '6611235915522259' },
        ['lid:66244327888465593'],
      ),
    ).toBe(false);
  });

  it('accepts the row whose stored phone is on this payload', () => {
    expect(
      isContactOnPayload(
        { id: 'seb', phone: 'lid:66244327888465593' },
        ['lid:66244327888465593', '573131423412'],
      ),
    ).toBe(true);
  });
});

describe('selectMergeableLosers', () => {
  it('merges exactly one handle with exactly one E.164 from this payload', () => {
    const phone = { id: 'p', phone: '573131423412' };
    const lid = { id: 'l', phone: 'lid:66244327888465593' };
    const picked = selectMergeableLosers([phone, lid], 'lid:66244327888465593', {
      aliases: ['lid:66244327888465593', '573131423412'],
      lid: '66244327888465593',
    });
    expect(picked.survivor.id).toBe('p');
    expect(picked.losers.map((c) => c.id)).toEqual(['l']);
  });

  it('does not merge three contacts even when two would be a valid pair', () => {
    const phone = { id: 'p', phone: '573023582969' };
    const lid = { id: 'l', phone: 'lid:6611235915522259' };
    const other = { id: 'x', phone: 'lid:66244327888465593' };
    const picked = selectMergeableLosers(
      [phone, lid, other],
      'lid:6611235915522259',
      {
        aliases: [
          'lid:6611235915522259',
          '573023582969',
          'lid:66244327888465593',
        ],
        lid: '6611235915522259',
      },
    );
    expect(picked.losers).toEqual([]);
    expect(picked.survivor.id).toBe('l');
  });

  it('may merge @username + LID + phone of the same person', () => {
    const phone = { id: 'p', phone: '573023582969' };
    const lid = { id: 'l', phone: 'lid:6611235915522259' };
    const user = { id: 'u', phone: 'user:edwinvargas21' };
    const picked = selectMergeableLosers([phone, lid, user], 'user:edwinvargas21', {
      aliases: [
        'user:edwinvargas21',
        'lid:6611235915522259',
        '573023582969',
      ],
      lid: '6611235915522259',
      username: 'edwinvargas21',
    });
    expect(picked.survivor.id).toBe('p');
    expect(picked.losers.map((c) => c.id).sort()).toEqual(['l', 'u']);
  });

  it('does not merge two E.164 numbers', () => {
    const a = { id: 'a', phone: '573023582969' };
    const b = { id: 'b', phone: '573131423412' };
    const picked = selectMergeableLosers([a, b], '573023582969', {
      aliases: ['573023582969', '573131423412'],
    });
    expect(picked.survivor.id).toBe('a');
    expect(picked.losers).toEqual([]);
  });
});

describe('isProvenPeerPair', () => {
  it('requires both phone keys to appear on the payload', () => {
    expect(
      isProvenPeerPair(
        { id: 'p', phone: '573023582969' },
        { id: 'l', phone: 'lid:6611235915522259' },
        { lid: '6611235915522259', aliases: ['lid:6611235915522259'] },
      ),
    ).toBe(false);
    expect(
      isProvenPeerPair(
        { id: 'p', phone: '573023582969' },
        { id: 'l', phone: 'lid:6611235915522259' },
        {
          lid: '6611235915522259',
          aliases: ['lid:6611235915522259', '573023582969'],
        },
      ),
    ).toBe(true);
  });
});

describe('listComplementaryNameTwinPairs', () => {
  it('joins the unique Sebastian LID + phone pair and skips another name', () => {
    const pairs = listComplementaryNameTwinPairs([
      { id: 'p', phone: '573112423412', name: 'Sebastian' },
      { id: 'l', phone: 'lid:244327888465953', name: 'Sebastian' },
      { id: 'z', phone: '573000000000', name: 'sebastian lozano mtto' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe('p');
    expect(pairs[0].loser.id).toBe('l');
  });

  it('does not join two people who happen to share a first name with extras', () => {
    expect(
      listComplementaryNameTwinPairs([
        { id: 'p', phone: '573112423412', name: 'Sebastian' },
        { id: 'l', phone: 'lid:244327888465953', name: 'Sebastian' },
        { id: 'x', phone: 'lid:999', name: 'Sebastian' },
      ]),
    ).toEqual([]);
  });

  it('joins the soccer-ball chats even when one name has a variation selector', () => {
    const pairs = listComplementaryNameTwinPairs([
      { id: 'p', phone: '573008579176', name: '⚽' },
      { id: 'l', phone: 'lid:43048675373122', name: '⚽\uFE0F' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe('p');
    expect(pairs[0].loser.id).toBe('l');
  });

  it('does not join Memo and a number-labeled phone just because they wrote close together', () => {
    expect(
      listComplementaryNameTwinPairs([
        { id: 'p', phone: '573212030877', name: '573212030877' },
        { id: 'l', phone: 'lid:43048675373122', name: 'Memo' },
      ]),
    ).toEqual([]);
  });
});

describe('listSharedProviderMessagePairs', () => {
  it('joins LID and phone that stored the same WhatsApp message id', () => {
    const pairs = listSharedProviderMessagePairs([
      {
        messageId: 'ABC',
        conversationId: 'c-lid',
        contactId: 'l',
        contactPhone: 'lid:43048675373122',
        channel: 'wa1',
      },
      {
        messageId: 'ABC',
        conversationId: 'c-pn',
        contactId: 'p',
        contactPhone: '573212030877',
        channel: 'wa1',
      },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe('p');
    expect(pairs[0].loserId).toBe('l');
  });

  it('does not join two phones that share an id', () => {
    expect(
      listSharedProviderMessagePairs([
        {
          messageId: 'ABC',
          conversationId: 'c1',
          contactId: 'a',
          contactPhone: '573212030877',
          channel: 'wa1',
        },
        {
          messageId: 'ABC',
          conversationId: 'c2',
          contactId: 'b',
          contactPhone: '573000000001',
          channel: 'wa1',
        },
      ]),
    ).toEqual([]);
  });
});

describe('listStampedLidPairs', () => {
  it('joins a lid: row onto the E.164 that already has that whatsapp_lid', () => {
    const pairs = listStampedLidPairs([
      { id: 'p', phone: '573008579176', name: '573008579176', whatsapp_lid: '43048675373122' },
      { id: 'l', phone: 'lid:43048675373122', name: '⚽' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe('p');
    expect(pairs[0].loser.id).toBe('l');
  });
});

describe('pickComplementaryNameTwin', () => {
  it('joins a LID and a phone that share a real first name like Sebastian', () => {
    expect(
      pickComplementaryNameTwin('lid:244327888465953', 'Sebastian', [
        { id: 'p', phone: '573112423412', name: 'Sebastian' },
      ])?.id,
    ).toBe('p');
  });

  it('joins a LID and a phone that share the same pushName and nobody else does', () => {
    expect(
      pickComplementaryNameTwin('lid:6611235915522259', 'AL', [
        { id: 'p', phone: '573023582969', name: 'AL' },
      ])?.id,
    ).toBe('p');
  });

  it('does not join two phones or two people with the same name', () => {
    expect(
      pickComplementaryNameTwin('573000000001', 'AL', [
        { id: 'p', phone: '573023582969', name: 'AL' },
      ]),
    ).toBeNull();
    expect(
      pickComplementaryNameTwin('lid:1', 'AL', [
        { id: 'p', phone: '573023582969', name: 'AL' },
        { id: 'q', phone: '573131423412', name: 'AL' },
      ]),
    ).toBeNull();
  });
});
