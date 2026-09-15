-- ============================================================
-- 048_conversation_channel_no_cross_number
--
-- Evolution multi-number accounts were collapsing the same contact
-- onto one conversation when the old UNIQUE(account_id, contact_id)
-- index (migration 036) was still present. Inbound on number B then
-- reused the thread stamped for number A — sent in one inbox window,
-- received in another.
--
-- 1. Drop the leftover per-contact unique (idempotent; 039/047 also
--    try this).
-- 2. Ensure the per-channel unique exists.
-- 3. Stamp null-channel conversations when the account has EXACTLY
--    ONE Evolution number and no Meta number — those rows can only
--    belong to that instance. Mixed Meta+Evolution or two Evolution
--    numbers are left null (cannot guess).
-- ============================================================

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (
    account_id,
    contact_id,
    COALESCE(whatsapp_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

WITH evo_counts AS (
  SELECT account_id,
         (array_agg(id ORDER BY created_at))[1] AS evolution_config_id,
         count(*) AS n
  FROM whatsapp_config
  WHERE provider = 'evolution'
  GROUP BY account_id
),
single_evolution AS (
  SELECT e.account_id, e.evolution_config_id
  FROM evo_counts e
  WHERE e.n = 1
    AND NOT EXISTS (
      SELECT 1
      FROM whatsapp_config w2
      WHERE w2.account_id = e.account_id
        AND w2.provider = 'meta'
    )
)
UPDATE conversations c
SET whatsapp_config_id = se.evolution_config_id,
    updated_at = NOW()
FROM single_evolution se
WHERE c.account_id = se.account_id
  AND c.whatsapp_config_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM conversations c2
    WHERE c2.account_id = c.account_id
      AND c2.contact_id = c.contact_id
      AND c2.whatsapp_config_id = se.evolution_config_id
  );
