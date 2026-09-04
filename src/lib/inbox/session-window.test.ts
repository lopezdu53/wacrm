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

  it('is false when the thread has no stamped channel', () => {
    expect(conversationHasNoSessionWindow(null, providers)).toBe(false);
    expect(conversationHasNoSessionWindow(undefined, providers)).toBe(false);
  });
});
