import { describe, expect, it } from 'vitest';

import {
  isContactOnPayload,
  isProvenPeerPair,
  pickSurvivorContact,
  selectMergeableLosers,
} from './merge-peer';

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
  it('rejects an E.164 row that only matched via a leftover whatsapp_lid stamp', () => {
    expect(
      isContactOnPayload(
        { id: 'mega', phone: '573023582969', whatsapp_lid: '66244327888465593' },
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
