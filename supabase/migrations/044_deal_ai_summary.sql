-- ============================================================
-- 044_deal_ai_summary
--
-- A short, AI-written summary of what the customer is looking for
-- (e.g. which machine + key specs), stored on the deal so it shows on
-- the pipeline card and in the deal form. Kept SEPARATE from `notes`
-- (which stays for humans) so the AI refreshing the summary never
-- clobbers a teammate's own notes.
--
-- Idempotent.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS ai_summary text;
