-- ============================================================
-- 045_backfill_meta_channel
--
-- The Meta inbound webhook had its own legacy conversation lookup
-- (separate from the shared, channel-aware one Evolution already
-- used) that never stamped `whatsapp_config_id`. Every Meta-inbound
-- conversation was created with it NULL. That broke two things once
-- an account had more than one WhatsApp number:
--   1. A contact writing to two different Meta numbers collapsed onto
--      ONE shared conversation instead of two.
--   2. Reply-sending falls back to "the account's oldest whatsapp_config"
--      when a conversation has no channel — for an account that set
--      up Evolution before Meta, that fallback silently sent replies
--      out an Evolution number instead of the Meta number the
--      customer actually wrote to.
--
-- The code path is now fixed (Meta inbound stamps its config id like
-- Evolution always did). This migration repairs the conversations
-- that were already created wrong: for any account with EXACTLY ONE
-- Meta number, a null-channel conversation is unambiguously that
-- number — backfill it. Accounts with two+ Meta numbers are left
-- alone (can't know which one a null row belongs to without guessing).
--
-- Idempotent: only touches rows still NULL, and skips any row whose
-- backfill would collide with the per-channel unique index (migration
-- 039) — i.e. a properly-scoped conversation already exists for that
-- contact + channel.
-- ============================================================

WITH single_meta AS (
  SELECT account_id, (array_agg(id))[1] AS meta_config_id
  FROM whatsapp_config
  WHERE provider = 'meta'
  GROUP BY account_id
  HAVING count(*) = 1
)
UPDATE conversations c
SET whatsapp_config_id = sm.meta_config_id,
    updated_at = NOW()
FROM single_meta sm
WHERE c.account_id = sm.account_id
  AND c.whatsapp_config_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM conversations c2
    WHERE c2.account_id = c.account_id
      AND c2.contact_id = c.contact_id
      AND c2.whatsapp_config_id = sm.meta_config_id
  );
