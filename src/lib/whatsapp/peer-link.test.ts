import { describe, expect, it } from 'vitest';

import {
  exclusiveLinkedKeys,
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

  it('fetches history for a phone-only fromMe that is not yet stamped', () => {
    const phonePeer: EvolutionPeer = {
      contactKey: '573023582969',
      phone: '573023582969',
      lid: null,
      username: null,
    };
    expect(
      needsHistoryLink(phonePeer, [{ id: 'c1', phone: '573023582969' }]),
    ).toBe(true);
    expect(
      needsHistoryLink(phonePeer, [
        { id: 'c1', phone: '573023582969', whatsapp_lid: '6611235915522259' },
      ]),
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

describe('exclusiveLinkedKeys', () => {
  it('maps a scoped LID chat rewritten to one E.164', () => {
    expect(
      exclusiveLinkedKeys(lidPeer, [
        { key: { remoteJid: '573023582969@s.whatsapp.net', id: 'a' } },
        { key: { remoteJid: '573023582969@s.whatsapp.net', id: 'b' } },
      ]),
    ).toEqual(['573023582969']);
  });

  it('maps LID history that also lists the phone as remoteJidAlt', () => {
    expect(
      exclusiveLinkedKeys(lidPeer, [
        {
          key: {
            remoteJid: '6611235915522259@lid',
            remoteJidAlt: '573023582969@s.whatsapp.net',
            id: 'a',
          },
        },
      ]),
    ).toEqual(['573023582969']);
  });

  it('refuses unscoped history that names several phones', () => {
    expect(
      exclusiveLinkedKeys(lidPeer, [
        { key: { remoteJid: '573023582969@s.whatsapp.net', id: 'a' } },
        { key: { remoteJid: '573131423412@s.whatsapp.net', id: 'b' } },
        { key: { remoteJid: '573000000000@s.whatsapp.net', id: 'c' } },
      ]),
    ).toEqual([]);
  });

  it('maps a phone-only fromMe onto the LID Evolution stored on that chat', () => {
    expect(
      exclusiveLinkedKeys(
        {
          contactKey: '573023582969',
          phone: '573023582969',
          lid: null,
          username: null,
        },
        [
          {
            key: {
              remoteJid: '573023582969@s.whatsapp.net',
              remoteJidAlt: '6611235915522259@lid',
              id: 'a',
            },
          },
        ],
      ),
    ).toEqual(['lid:6611235915522259']);
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
