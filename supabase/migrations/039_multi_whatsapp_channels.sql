-- ============================================================
-- 039_multi_whatsapp_channels
--
-- Lets one account connect MORE THAN ONE WhatsApp number/channel — the
-- first step being multiple Evolution API instances. Until now
-- `whatsapp_config` was UNIQUE(account_id) (one number per account) and
-- conversations weren't tied to a specific number, so a second instance
-- had nowhere to live and replies couldn't know which number to send
-- from.
--
-- Changes:
--   1. Drop the one-config-per-account UNIQUE so an account can hold
--      several config rows (one per number/instance).
--   2. Add `label` — a human name for the channel shown in the UI.
--   3. Tie conversations to the channel that owns them via
--      `whatsapp_config_id`, and backfill existing rows to the account's
--      current single config.
--   4. Re-dedup conversations per (account, contact, channel): the same
--      contact writing to two different numbers is now two conversations,
--      while contacts on a single channel stay deduped exactly as before.
--
-- Idempotent. No data loss.
-- ============================================================

-- 1) Allow multiple configs per account.
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- 2) Human label for the channel (e.g. "Ventas", "Soporte").
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT;

-- An account + instance name pair must stay unique so the inbound
-- Evolution webhook resolves one config; the global instance-unique index
-- from migration 037 already guarantees this, but scope it per account
-- too for clarity.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_account_instance_unique
  ON whatsapp_config (account_id, evolution_instance)
  WHERE evolution_instance IS NOT NULL;

-- 3) Channel ownership on conversations.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
    REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- Backfill: for every account that has exactly one config, point all its
-- conversations at that config. Accounts with 0 or ≥2 configs are left
-- NULL (nothing to disambiguate to, or already multi-channel).
UPDATE conversations c
SET whatsapp_config_id = w.id
FROM (
  SELECT account_id, MIN(id) AS id
  FROM whatsapp_config
  GROUP BY account_id
  HAVING COUNT(*) = 1
) w
WHERE c.account_id = w.account_id
  AND c.whatsapp_config_id IS NULL;

-- 4) Re-dedup per channel. Replace the (account, contact) unique index
--    from migration 036 with one that also keys on the channel. NULL
--    config_id collapses to a fixed sentinel so single-channel and
--    legacy rows keep the old (account, contact) uniqueness.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (
    account_id,
    contact_id,
    COALESCE(whatsapp_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
