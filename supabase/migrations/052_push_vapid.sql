-- ============================================================
-- 052_push_vapid
--
-- Singleton VAPID key pair so Web Push works when the operator has
-- not set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. The app generates
-- keys once and stores them here (service role only). Env vars still
-- win when present.
--
-- Required for lock-screen / killed-app alerts on the phone.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_vapid (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE push_vapid ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON push_vapid FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON push_vapid TO service_role;
