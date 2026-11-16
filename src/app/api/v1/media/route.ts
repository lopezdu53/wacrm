// ============================================================
// POST /api/v1/media — upload a file and get back a public URL to
// pass as `media_url` to POST /api/v1/messages.
//
// Exists for callers that HAVE file bytes (e.g. a PDF an external
// tool just generated — a quoting system, a report) but have nowhere
// public to host them: /api/v1/messages requires media_url to be a
// URL both wacrm's own server AND Meta's/Evolution's servers can
// fetch, so a caller can't just hand over base64 directly to the
// send endpoint. This stages the bytes in the same storage bucket
// the dashboard's own inbox composer uploads outbound attachments
// to, then returns that URL.
//
// Auth: API key with the `messages:send` scope — uploading is only
// useful alongside sending, so no separate scope.
//
// Body:
//   {
//     "filename": "quote-1234.pdf",
//     "mime_type": "application/pdf",      // optional, defaults to octet-stream
//     "content_base64": "JVBERi0xLjQK..."  // a data: URL prefix is fine too
//   }
//
// Response (201):
//   { "data": { "url": "https://…/chat-media/account-…/….pdf" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { storeOutboundMediaBytes } from '@/lib/api/v1/media-upload'

function decodeBase64(value: string): Buffer | null {
  try {
    const payload = value.includes(',') ? value.split(',').pop()! : value
    return Buffer.from(payload, 'base64')
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : ''
    if (!filename) {
      return fail('bad_request', "'filename' is required", 400)
    }
    const mimeType = typeof body?.mime_type === 'string' ? body.mime_type.trim() : null
    const base64 = typeof body?.content_base64 === 'string' ? body.content_base64 : ''
    if (!base64) {
      return fail('bad_request', "'content_base64' is required", 400)
    }

    const bytes = decodeBase64(base64)
    if (!bytes) {
      return fail('bad_request', "'content_base64' is not valid base64", 400)
    }

    const { url } = await storeOutboundMediaBytes(ctx.supabase, ctx.accountId, {
      filename,
      mimeType,
      bytes,
    })
    return ok({ url }, 201)
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
