-- ============================================================
-- 043_internal_chat
--
-- Team-only chat between account members — direct messages (1:1) and
-- named group chats. Completely separate from the customer inbox
-- (conversations/messages): this never touches WhatsApp, it's just
-- staff talking to staff, like GoHighLevel's "Internal chat".
--
-- Model
--   internal_channels          a DM or a group, scoped to one account
--   internal_channel_members   who is in the channel (+ their last_read)
--   internal_messages          the messages in a channel
--
-- Visibility is membership-based: you see a channel, its members, and
-- its messages iff you belong to it. To avoid the classic
-- channel<->members RLS recursion, membership is resolved through a
-- SECURITY DEFINER helper that reads the members table as its owner.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS internal_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
  -- Group name; NULL for DMs (the UI labels a DM by the other member).
  name TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_internal_channels_account ON internal_channels(account_id);

CREATE TABLE IF NOT EXISTS internal_channel_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES internal_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_internal_channel_members_channel ON internal_channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_internal_channel_members_user ON internal_channel_members(user_id);

CREATE TABLE IF NOT EXISTS internal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES internal_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_internal_messages_channel ON internal_messages(channel_id, created_at);

-- Is the current auth user a member of this channel? SECURITY DEFINER
-- so the channel/messages policies can check membership WITHOUT the
-- members table's own RLS re-entering the channel policy (recursion).
CREATE OR REPLACE FUNCTION is_internal_channel_member(target_channel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM internal_channel_members m
    WHERE m.channel_id = target_channel_id
      AND m.user_id = auth.uid()
  );
$$;
ALTER FUNCTION is_internal_channel_member(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_internal_channel_member(UUID) TO authenticated, service_role;

ALTER TABLE internal_channels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_messages        ENABLE ROW LEVEL SECURITY;

-- Channels: readable by members within the account. Writes (create,
-- rename) go through service-role API routes after a membership check,
-- so no client INSERT/UPDATE policy is exposed here.
DROP POLICY IF EXISTS internal_channels_select ON internal_channels;
CREATE POLICY internal_channels_select ON internal_channels FOR SELECT
  USING (is_account_member(account_id) AND is_internal_channel_member(id));

-- Members: a member can see the full membership of their channels.
DROP POLICY IF EXISTS internal_channel_members_select ON internal_channel_members;
CREATE POLICY internal_channel_members_select ON internal_channel_members FOR SELECT
  USING (is_internal_channel_member(channel_id));

-- A member may update their OWN member row (used to bump last_read_at
-- from the client). No other columns matter for correctness here.
DROP POLICY IF EXISTS internal_channel_members_update_self ON internal_channel_members;
CREATE POLICY internal_channel_members_update_self ON internal_channel_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Messages: members read; members post as themselves.
DROP POLICY IF EXISTS internal_messages_select ON internal_messages;
CREATE POLICY internal_messages_select ON internal_messages FOR SELECT
  USING (is_internal_channel_member(channel_id));

DROP POLICY IF EXISTS internal_messages_insert ON internal_messages;
CREATE POLICY internal_messages_insert ON internal_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND is_internal_channel_member(channel_id));

-- Realtime: the inbox-style live updates need these tables in the
-- publication. Guarded so re-running the migration doesn't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'internal_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE internal_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'internal_channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE internal_channels;
  END IF;
END $$;
