-- ============================================================
-- 055_product_media_64mb.sql
--
-- Product-library videos (e.g. a 51 MB institutional MP4) cannot
-- fit in the 16 MB product-media bucket. Raise the object cap so
-- Odoo can push them as raw multipart instead of JSON base64.
--
-- WhatsApp still prefers ≤16 MB for in-chat video playback; larger
-- files are stored for send-as-file. Idempotent.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 67108864
WHERE id = 'product-media';
