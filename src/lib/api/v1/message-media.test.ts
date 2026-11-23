import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { baseMime, isOwnStorageUrl, mimeFromUrl } from './message-media';

describe('message media helpers', () => {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
  });

  it('strips codec parameters from a MIME type', () => {
    expect(baseMime('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(baseMime('')).toBeNull();
    expect(baseMime(undefined)).toBeNull();
  });

  it('guesses the MIME type from the file extension', () => {
    expect(mimeFromUrl('https://x/a/b/file.PDF?token=1')).toBe('application/pdf');
    expect(mimeFromUrl('https://x/voice.ogg')).toBe('audio/ogg');
    expect(mimeFromUrl('https://x/photo.jpeg')).toBe('image/jpeg');
    expect(mimeFromUrl('https://x/noext')).toBeNull();
  });

  it('only downloads from this project public storage', () => {
    expect(
      isOwnStorageUrl(
        'https://proj.supabase.co/storage/v1/object/public/chat-media/a.jpg'
      )
    ).toBe(true);
    expect(isOwnStorageUrl('https://proj.supabase.co/rest/v1/messages')).toBe(false);
    expect(isOwnStorageUrl('https://evil.example/storage/v1/object/public/x')).toBe(false);
    expect(isOwnStorageUrl('http://169.254.169.254/latest')).toBe(false);
    expect(isOwnStorageUrl('/api/whatsapp/media/123')).toBe(false);
  });
});
