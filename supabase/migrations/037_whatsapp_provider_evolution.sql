-- ============================================================
-- 037_whatsapp_provider_evolution
--
-- Adds a second WhatsApp transport alongside the official Meta Cloud
-- API: Evolution API (an unofficial WhatsApp-Web/Baileys gateway that
-- connects by scanning a QR code). The app was Meta-only; this makes
-- `whatsapp_config` provider-aware so an account can connect either way.
--
-- Design:
--   * `provider` selects the transport ('meta' | 'evolution').
--   * Meta rows keep using phone_number_id / access_token / verify_token.
--   * Evolution rows use evolution_base_url + evolution_api_key
--     (AES-256-GCM encrypted, same as access_token) + evolution_instance.
--   * phone_number_id and access_token become NULLABLE — an Evolution
--     row has neither. A CHECK enforces that each provider carries the
--     columns it needs, so a malformed row can't be saved.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1) Provider discriminator. Defaults to 'meta' so every existing row
--    keeps its current behaviour with no data migration.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
  CHECK (provider IN ('meta', 'evolution'));

-- 2) Evolution-specific columns.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT,
  ADD COLUMN IF NOT EXISTS evolution_api_key TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT;

-- 3) Meta columns become optional — an Evolution row has no
--    phone_number_id / access_token.
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;

-- 4) Per-provider integrity. Each provider must carry the credentials
--    its transport needs; neither can be half-configured.
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_provider_columns_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_columns_check
  CHECK (
    (provider = 'meta'
       AND phone_number_id IS NOT NULL
       AND access_token IS NOT NULL)
    OR
    (provider = 'evolution'
       AND evolution_base_url IS NOT NULL
       AND evolution_api_key IS NOT NULL
       AND evolution_instance IS NOT NULL)
  );

-- 5) The inbound Evolution webhook resolves the owning account by
--    instance name, so it must map to at most one config row.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_evolution_instance_unique
  ON whatsapp_config (evolution_instance)
  WHERE evolution_instance IS NOT NULL;
