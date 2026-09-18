-- ============================================================
-- 046_message_id_conversation_unique
--
-- Inbound webhooks (Meta retries, Evolution upsert + sync backfill)
-- can race two inserts of the same provider message id into one
-- conversation. Dedup in application code is check-then-insert and
-- is not authoritative. message_id is intentionally NOT unique
-- globally (migration 009 — the same Meta wamid can appear on two
-- numbers), but it should be unique *per conversation*.
--
-- This migration:
--   1. collapses any existing (conversation_id, message_id) duplicates
--      (keep the oldest row);
--   2. adds a partial unique index so a concurrent retry is a 23505
--      the inbound path can treat as "already stored".
--
-- Idempotent. No data loss of distinct messages.
-- ============================================================

-- 1) Drop extras, keeping the oldest row per (conversation, message_id).
DELETE FROM messages m
WHERE m.message_id IS NOT NULL
  AND m.message_id <> ''
  AND m.id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM messages
      WHERE message_id IS NOT NULL AND message_id <> ''
    ) ranked
    WHERE rn > 1
  );

-- 2) Authoritative per-thread dedup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL AND message_id <> '';
