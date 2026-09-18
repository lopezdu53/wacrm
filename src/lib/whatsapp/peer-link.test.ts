import { describe, expect, it } from 'vitest';

import {
  historyMessageIds,
  needsHistoryLink,
  remoteJidsForHistory,
} from './peer-link';
import type { EvolutionPeer } from './peer-identity';

const lidPeer: EvolutionPeer = {
  contactKey: 'lid:6611235915522259',
  phone: null,
  lid: '6611235915522259',
  username: null,
};

describe('needsHistoryLink', () => {
  it('fetches history only for handle-only peers not already on an E.164', () => {
    expect(needsHistoryLink(lidPeer, [])).toBe(true);
    expect(
      needsHistoryLink(lidPeer, [
        { id: 'c1', phone: 'lid:6611235915522259' },
      ]),
    ).toBe(true);
    expect(
      needsHistoryLink(lidPeer, [{ id: 'c1', phone: '573023582969' }]),
    ).toBe(false);
    expect(
      needsHistoryLink(
        { ...lidPeer, phone: '573023582969' },
        [{ id: 'c1', phone: 'lid:6611235915522259' }],
      ),
    ).toBe(false);
  });
});

describe('historyMessageIds', () => {
  it('dedupes provider ids from Evolution history', () => {
    expect(
      historyMessageIds([
        { key: { id: 'AAA' } },
        { key: { id: 'AAA' } },
        { key: { id: 'BBB' } },
        { key: {} },
      ]),
    ).toEqual(['AAA', 'BBB']);
  });
});

describe('remoteJidsForHistory', () => {
  it('asks Evolution for the LID chat and the username chat', () => {
    expect(
      remoteJidsForHistory({
        contactKey: 'user:edwinvargas21',
        phone: null,
        lid: '6611235915522259',
        username: 'edwinvargas21',
      }),
    ).toEqual(
      expect.arrayContaining([
        '6611235915522259@lid',
        'edwinvargas21@s.whatsapp.net',
      ]),
    );
  });
});
