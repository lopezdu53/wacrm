-- ============================================================
-- 047_conversation_channel_unique_again
--
-- Migration 039 replaced UNIQUE(account_id, contact_id) with a
-- per-channel unique so the same person writing to two WhatsApp
-- numbers gets two conversations. Some projects applied later
-- migrations (046) without 039, or the old index survived. Then
-- the second Evolution inbound hits 23505, find-or-create returns
-- null, and the message is dropped — both inboxes look empty.
--
-- Idempotent. Re-drops the 036 index and ensures the 039 unique.
-- ============================================================

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (
    account_id,
    contact_id,
    COALESCE(whatsapp_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
