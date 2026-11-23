-- ============================================================
-- 058_message_media_transcript
--
-- Text read out of a message's attachment: the transcription of a
-- voice note, or the text of a PDF. Filled on demand the first time
-- an integration asks to "read" the attachment
-- (GET /api/v1/messages/{id}/media), then reused so the same audio is
-- never transcribed — and paid for — twice.
--
-- Optional: the endpoint works without this column, it just can't
-- cache. Idempotent.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_transcript TEXT;
