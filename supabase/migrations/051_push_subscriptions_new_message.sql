-- ============================================================
-- PUSH SUBSCRIPTIONS + new_message notifications
--
-- Web Push (VAPID) endpoints so an installed PWA on Android/iPhone
-- can alert the agent when a customer WhatsApp message arrives.
-- Rows are created by POST /api/push/subscribe (the signed-in user)
-- and consumed by the inbound pipeline with the service role.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account
  ON push_subscriptions(account_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_update ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;

-- Recipients own their device endpoints. The inbound worker uses the
-- service role (bypasses RLS) to look them up and send.
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY push_subscriptions_insert ON push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY push_subscriptions_update ON push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO authenticated;

-- ============================================================
-- notifications.type: add new_message
--
-- 027 only allowed conversation_assigned. Postgres names an inline
-- CHECK `notifications_type_check`. Drop + recreate so inbound can
-- insert the new type via the service role.
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'new_message'));

CREATE INDEX IF NOT EXISTS idx_notifications_unread_new_message
  ON notifications(user_id, conversation_id)
  WHERE read_at IS NULL AND type = 'new_message';
