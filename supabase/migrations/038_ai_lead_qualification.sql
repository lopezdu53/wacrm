-- ============================================================
-- 038_ai_lead_qualification
--
-- Lets the AI assistant qualify inbound leads: as it chats it extracts
-- the buyer's details (name, email, company, tax id, address), writes
-- them back onto the contact, and — once there's enough to act on —
-- opens a deal in a chosen pipeline automatically.
--
-- Adds three settings to `ai_configs`:
--   * auto_qualify_enabled   — master switch for the behaviour.
--   * qualify_pipeline_id     — pipeline the auto-created deal lands in.
--   * qualify_stage_id        — stage within that pipeline.
-- Both FKs are ON DELETE SET NULL so deleting a pipeline/stage just
-- falls back to "first pipeline / first stage" at runtime.
--
-- NIT/CC and address are stored as per-account custom fields, created
-- lazily in code the first time qualification runs — no schema here.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_qualify_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS qualify_pipeline_id uuid
    REFERENCES pipelines(id) ON DELETE SET NULL;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS qualify_stage_id uuid
    REFERENCES pipeline_stages(id) ON DELETE SET NULL;
