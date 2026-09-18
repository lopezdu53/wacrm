-- ============================================================
-- 050_whatsapp_lid_username_aliases
--
-- Evolution addresses the same person as a phone (PN) on outbound /
-- fromMe and as a LID (`662…@lid`) on inbound. Storing only
-- contacts.phone split those into two inbox threads (greens in one,
-- greys in the other).
--
-- These alias columns let inbound LID events find the PN contact
-- (and vice versa) after any message that carried both ids.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whatsapp_lid TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_lid
  ON contacts (account_id, whatsapp_lid)
  WHERE whatsapp_lid IS NOT NULL AND whatsapp_lid <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_whatsapp_username
  ON contacts (account_id, lower(whatsapp_username))
  WHERE whatsapp_username IS NOT NULL AND whatsapp_username <> '';
