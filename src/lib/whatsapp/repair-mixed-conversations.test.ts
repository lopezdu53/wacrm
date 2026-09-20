import { describe, expect, it } from 'vitest';

import {
  assignMessagesToPeers,
  contactPhoneMatchesPeer,
  handlePhoneLinksFromPeers,
  enrichPeerWithLinks,
} from './repair-mixed-conversations';
import type { EvolutionPeer } from './peer-identity';

describe('assignMessagesToPeers', () => {
  it('keeps Mao and Sebastian on separate identities', () => {
    const assigned = assignMessagesToPeers([
      {
        key: { id: 'mao-in', remoteJid: '6611235915522259@lid' },
        pushName: 'Mao Vargas',
      },
      {
        key: {
          id: 'mao-out',
          remoteJid: '573023582969@s.whatsapp.net',
          remoteJidAlt: '6611235915522259@lid',
          fromMe: true,
        },
        pushName: 'Envasadoras Colombia',
      },
      {
        key: { id: 'seb-in', remoteJid: '66244327888465593@lid' },
        pushName: 'Sebastian',
      },
      {
        key: {
          id: 'seb-out',
          remoteJid: '573131423412@s.whatsapp.net',
          remoteJidAlt: '66244327888465593@lid',
          fromMe: true,
        },
      },
    ]);

    expect(assigned.get('mao-in')?.peer.lid).toBe('6611235915522259');
    expect(assigned.get('mao-out')?.peer.lid).toBe('6611235915522259');
    expect(assigned.get('seb-in')?.peer.lid).toBe('66244327888465593');
    expect(assigned.get('seb-out')?.peer.lid).toBe('66244327888465593');
    expect(assigned.get('mao-in')?.peer.contactKey).not.toBe(
      assigned.get('seb-in')?.peer.contactKey,
    );
    expect(assigned.get('mao-out')?.pushName).toBe('');
    expect(assigned.get('mao-in')?.pushName).toBe('Mao Vargas');
  });

  it('drops a provider id that appears on two unrelated phones', () => {
    const assigned = assignMessagesToPeers([
      { key: { id: 'dup', remoteJid: '573023582969@s.whatsapp.net' } },
      { key: { id: 'dup', remoteJid: '573131423412@s.whatsapp.net' } },
    ]);
    expect(assigned.has('dup')).toBe(false);
  });
});

describe('contactPhoneMatchesPeer', () => {
  const mao: EvolutionPeer = {
    contactKey: 'lid:6611235915522259',
    phone: '573023582969',
    lid: '6611235915522259',
    username: 'edwinvargas21',
  };

  it('matches the E.164 or LID row for that person only', () => {
    expect(contactPhoneMatchesPeer('573023582969', mao)).toBe(true);
    expect(contactPhoneMatchesPeer('lid:6611235915522259', mao)).toBe(true);
    expect(contactPhoneMatchesPeer('user:edwinvargas21', mao)).toBe(true);
    expect(contactPhoneMatchesPeer('573131423412', mao)).toBe(false);
    expect(contactPhoneMatchesPeer('lid:66244327888465593', mao)).toBe(false);
  });
});

describe('handlePhoneLinksFromPeers', () => {
  it('applies a proven LID↔phone link to later LID-only history', () => {
    const links = handlePhoneLinksFromPeers([
      {
        contactKey: 'lid:6611235915522259',
        phone: '573023582969',
        lid: '6611235915522259',
        username: null,
      },
    ]);
    const lidOnly = enrichPeerWithLinks(
      {
        contactKey: 'lid:6611235915522259',
        phone: null,
        lid: '6611235915522259',
        username: null,
      },
      links,
    );
    expect(lidOnly.phone).toBe('573023582969');
    expect(lidOnly.contactKey).toBe('573023582969');
  });
});
