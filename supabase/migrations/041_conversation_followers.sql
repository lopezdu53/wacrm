-- ============================================================
-- 041_conversation_followers
--
-- "Followers" on a conversation — extra teammates who want to keep an eye
-- on a thread beyond its single owner (conversations.assigned_agent_id).
-- Mirrors the Owner + Followers model in other CRMs.
--
-- Visibility is unchanged: every account member already sees every
-- conversation (RLS is `is_account_member(account_id)`), so this is purely
-- an interest/notification list, not an access gate.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_followers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_followers_conversation
  ON conversation_followers (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_followers_user
  ON conversation_followers (user_id);

ALTER TABLE conversation_followers ENABLE ROW LEVEL SECURITY;

-- Any member of the conversation's account can read/manage its followers,
-- same trust boundary as the conversation itself.
DROP POLICY IF EXISTS conversation_followers_select ON conversation_followers;
CREATE POLICY conversation_followers_select ON conversation_followers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_followers.conversation_id
        AND is_account_member(c.account_id)
    )
  );

DROP POLICY IF EXISTS conversation_followers_write ON conversation_followers;
CREATE POLICY conversation_followers_write ON conversation_followers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_followers.conversation_id
        AND is_account_member(c.account_id, 'agent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_followers.conversation_id
        AND is_account_member(c.account_id, 'agent')
    )
  );
