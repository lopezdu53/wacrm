import { describe, expect, it } from 'vitest';

import {
  identityAliasesFromEvolutionRows,
  rowsFromEvolutionJson,
} from './evolution-api';

describe('identityAliasesFromEvolutionRows', () => {
  it('reads fetchLid wuid + lid as phone and handle keys', () => {
    expect(
      identityAliasesFromEvolutionRows([
        {
          wuid: '573106650491@s.whatsapp.net',
          lid: '6611235915522259@lid',
        },
      ]),
    ).toEqual(
      expect.arrayContaining(['573106650491', 'lid:6611235915522259']),
    );
  });

  it('reads a findContacts row that stores both JIDs', () => {
    expect(
      identityAliasesFromEvolutionRows([
        {
          id: '573130064581@s.whatsapp.net',
          remoteJidAlt: '6611235915522259@lid',
        },
      ]),
    ).toEqual(
      expect.arrayContaining(['573130064581', 'lid:6611235915522259']),
    );
  });
});

describe('rowsFromEvolutionJson', () => {
  it('accepts a bare LID string from older fetchLid builds', () => {
    expect(rowsFromEvolutionJson('6611235915522259@lid')).toEqual([
      { id: '6611235915522259@lid', lid: '6611235915522259@lid' },
    ]);
  });
});
