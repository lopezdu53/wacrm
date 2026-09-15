-- ============================================================
-- 049_whatsapp_username_lid_contact_keys
--
-- WhatsApp @username accounts (no visible phone) and LID-only chats
-- must not share a contact with each other or with E.164 numbers.
--
-- contacts.phone_normalized is digits-only. Storing `user:1e4ndra`
-- made it `14`, so every handle whose letters hide the same digits
-- collided on idx_contacts_account_phone_normalized (migration 022).
-- LID digits also last-8-matched unrelated phones in the app.
--
-- This migration:
--   1. regenerates phone_normalized so user:/lid: keys contribute
--      no digits (they stay out of the E.164 unique index);
--   2. unique-indexes those handle keys per account.
-- ============================================================

DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;

ALTER TABLE contacts DROP COLUMN IF EXISTS phone_normalized;

ALTER TABLE contacts
  ADD COLUMN phone_normalized TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN phone ~* '^(user:|lid:)' THEN ''
      ELSE regexp_replace(phone, '\D', '', 'g')
    END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_normalized
  ON contacts (account_id, phone_normalized)
  WHERE phone_normalized <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_handle_key
  ON contacts (account_id, lower(phone))
  WHERE phone ~* '^(user:|lid:)';
