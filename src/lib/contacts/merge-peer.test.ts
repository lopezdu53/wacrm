import { describe, expect, it } from 'vitest';

import { pickSurvivorContact } from './merge-peer';

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
