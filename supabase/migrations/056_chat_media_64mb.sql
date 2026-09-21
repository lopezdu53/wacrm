-- ============================================================
-- 056_chat_media_64mb.sql
--
-- WhatsApp Web videos (1–2 minutes) often exceed the 16 MB
-- chat-media cap, so Evolution downloads succeeded and the
-- Supabase upload was rejected — the inbox then showed no video.
-- Match the product-media 64 MB cap. Idempotent.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 67108864
WHERE id = 'chat-media';
