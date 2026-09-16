import { describe, expect, it } from 'vitest';

import { pickSurvivorContact } from './merge-peer';

describe('pickSurvivorContact', () => {
  it('keeps the contact whose phone matches the preferred chat key', () => {
    const phone = { id: 'p', phone: '573131423412' };
    const lid = { id: 'l', phone: 'lid:66244327888465593' };
    expect(pickSurvivorContact([phone, lid], 'lid:66244327888465593').id).toBe(
      'l',
    );
    expect(pickSurvivorContact([lid, phone], '573131423412').id).toBe('p');
  });
});
