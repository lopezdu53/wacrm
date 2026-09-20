-- ============================================================
-- 054_opportunity_inbox.sql
--
-- High-attention tray between Inbox and Internal Chat.
-- Agents send a WhatsApp conversation from the inbox into
-- Oportunidades (web) / Opp (phone). The chat stays the same
-- thread; only the lane flag changes.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_opportunity boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversations_account_opportunity
  ON public.conversations (account_id, is_opportunity)
  WHERE is_opportunity = true;
