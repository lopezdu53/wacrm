// ============================================================
// Outbound-media upload — turn bytes handed to the public API into a
// publicly fetchable URL, for a caller that has a file (e.g. a PDF a
// quoting tool just generated) but nowhere public to host it.
//
// Mirrors `uploadInboundMedia` (src/lib/whatsapp/evolution-inbound.ts)
// and `storeProductAssetBytes` (src/lib/api/v1/product-upsert.ts) —
// same bucket convention (account-scoped path, chat-media bucket) as
// the inbox composer's own file-send upload, since this is the same
// operation: "stage a file so it can be sent as WhatsApp media."
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { buildMediaPath, MEDIA_MAX_BYTES } from '@/lib/storage/upload-media'
import { badRequest } from '@/lib/api/v1/respond'

/** Same bucket the dashboard's inbox composer uploads outbound attachments to. */
const CHAT_MEDIA_BUCKET = 'chat-media'

export async function storeOutboundMediaBytes(
  supabase: SupabaseClient,
  accountId: string,
  args: { filename: string; mimeType: string | null; bytes: Buffer },
): Promise<{ url: string; path: string }> {
  if (args.bytes.length === 0) {
    throw badRequest('Decoded file is empty')
  }
  if (args.bytes.length > MEDIA_MAX_BYTES) {
    throw badRequest(
      `File exceeds the ${MEDIA_MAX_BYTES / (1024 * 1024)} MB limit (got ${(
        args.bytes.length /
        (1024 * 1024)
      ).toFixed(1)} MB)`,
    )
  }

  const path = buildMediaPath(accountId, args.filename)
  const { error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, args.bytes, {
      upsert: false,
      contentType: args.mimeType || 'application/octet-stream',
    })
  if (error) {
    throw badRequest(`Could not store the file: ${error.message}`)
  }

  const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}
