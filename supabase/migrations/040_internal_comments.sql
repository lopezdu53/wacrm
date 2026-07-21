-- ============================================================
-- 040_internal_comments
--
-- Internal team comments inside a conversation thread (like the
-- "Internal Comment" toggle in other CRMs). They live in `messages` so
-- they interleave chronologically with the real chat, but they are NEVER
-- sent to WhatsApp and are visible only to the team.
--
--   * is_internal = true       — marks the row as a team note.
--   * sender_type = 'agent'     — reuses the existing enum.
--   * sender_id                 — the author's auth.users id (already on
--                                 the table) so the UI can show who wrote it.
--
-- Idempotent.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- Fast path for the (rare) "internal notes only" reads and to keep the
-- inbox render cheap.
CREATE INDEX IF NOT EXISTS idx_messages_internal
  ON messages (conversation_id)
  WHERE is_internal = true;
