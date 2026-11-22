import { describe, expect, it } from 'vitest';

import { conversationHasNoSessionWindow } from './session-window';

describe('conversationHasNoSessionWindow', () => {
  const providers = {
    evo: 'evolution',
    meta: 'meta',
  };

  it('is true only for an Evolution channel', () => {
    expect(conversationHasNoSessionWindow('evo', providers)).toBe(true);
    expect(conversationHasNoSessionWindow('meta', providers)).toBe(false);
  });

  it('keeps the window for an unidentified thread when a Meta number exists', () => {
    expect(conversationHasNoSessionWindow(null, providers)).toBe(false);
    expect(conversationHasNoSessionWindow(undefined, providers)).toBe(false);
    expect(conversationHasNoSessionWindow('gone', providers)).toBe(false);
  });

  it('never gates an unidentified thread on an Evolution-only account', () => {
    const evoOnly = { evo: 'evolution', evo2: 'evolution' };
    expect(conversationHasNoSessionWindow(null, evoOnly)).toBe(true);
    expect(conversationHasNoSessionWindow('gone', evoOnly)).toBe(true);
    expect(conversationHasNoSessionWindow(null, {})).toBe(true);
  });
});
