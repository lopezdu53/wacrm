-- ============================================================
-- 042_restrict_to_assigned
--
-- Per-agent permission "Restrict data visibility to only assigned
-- data" (mirrors the GoHighLevel toggle in Roles & Permissions).
--
-- Until now every account member could see every conversation —
-- RLS was a flat `is_account_member(account_id)`. That is the right
-- default for owners/admins and for small teams, but larger teams
-- want an agent to only see the chats they own (assigned) or follow,
-- not the whole shared inbox.
--
-- This migration adds an opt-in, per-member flag on `profiles` and
-- narrows the SELECT policies on `conversations` and `messages` so a
-- *restricted* member only reads:
--   * conversations where they are the assigned agent, OR
--   * conversations they follow (conversation_followers), OR
--   * nothing else.
--
-- Design notes
--   * The flag only bites for agent/viewer members. Owners and
--     admins are never restricted, even if the flag is somehow set —
--     they are the ones who need the full shared view. This is baked
--     into `caller_restricted()` so it cannot be bypassed from the
--     app layer.
--   * Only visibility (SELECT) changes. Write policies are unchanged:
--     a restricted agent already can't open a conversation they can't
--     see, so there's no new surface to write through.
--   * Service-role paths (webhook inbound, cron) bypass RLS and are
--     unaffected — inbound delivery still lands on every conversation.
--
-- Idempotent.
-- ============================================================

-- 1. The per-member flag.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS restrict_to_assigned boolean NOT NULL DEFAULT false;

-- 2. Is the *current* auth user a restricted member of this account?
--    SECURITY DEFINER so it can read profiles regardless of the
--    caller's own RLS, STABLE so the planner can cache it per row.
--    Restriction is deliberately scoped to agent/viewer — owners and
--    admins always see the full account.
CREATE OR REPLACE FUNCTION caller_restricted(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.restrict_to_assigned = true
      AND p.account_role IN ('agent', 'viewer')
  );
$$;

ALTER FUNCTION caller_restricted(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION caller_restricted(UUID) TO authenticated, service_role;

-- 3. Does the current auth user follow this conversation?
--    This MUST be a SECURITY DEFINER function rather than an inline
--    `EXISTS (SELECT FROM conversation_followers …)` in the policy.
--    An inline subquery makes the conversations SELECT policy read
--    conversation_followers, whose own RLS reads conversations back —
--    an infinite-recursion cycle that Postgres aborts with SQLSTATE
--    42P17, breaking the whole inbox. Running as the table owner here
--    bypasses conversation_followers' RLS and cuts the cycle.
CREATE OR REPLACE FUNCTION caller_follows(target_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM conversation_followers f
    WHERE f.conversation_id = target_conversation_id
      AND f.user_id = auth.uid()
  );
$$;

ALTER FUNCTION caller_follows(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION caller_follows(UUID) TO authenticated, service_role;

-- 4. Narrow the conversation SELECT policy.
--    Membership is still required; on top of it, a restricted caller
--    only passes for conversations they own or follow.
DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
  is_account_member(account_id)
  AND (
    NOT caller_restricted(account_id)
    OR assigned_agent_id = auth.uid()
    OR caller_follows(conversations.id)
  )
);

-- 5. Narrow the message SELECT policy the same way — a message is
--    visible iff its parent conversation is visible to the caller.
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id)
      AND (
        NOT caller_restricted(c.account_id)
        OR c.assigned_agent_id = auth.uid()
        OR caller_follows(c.id)
      )
  )
);
