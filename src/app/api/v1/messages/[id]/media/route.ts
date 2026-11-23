// ============================================================
// GET /api/v1/messages/{id}/media — read a message's attachment
// (scope: messages:read).
//
// Returns a public URL to the file plus, depending on what it is:
// the image bytes (base64), the transcription of an audio, or the
// text of a PDF. See src/lib/api/v1/message-media.ts.
//
// Transcribing can take a while, hence the longer time limit.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { readMessageMedia } from '@/lib/api/v1/message-media';

export const maxDuration = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { id } = await params;
    return ok(await readMessageMedia(ctx.supabase, ctx.accountId, id));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
