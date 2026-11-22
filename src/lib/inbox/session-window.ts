/**
 * Meta Cloud API enforces a 24-hour customer-care window (free-form
 * text only after the contact writes; otherwise a template).
 * Evolution / WhatsApp Web has no such window — agents can always reply.
 *
 * This must be decided per conversation (the channel that owns the
 * thread), not per account. An account that also has a Meta number
 * must not lock Evolution inboxes behind a template.
 *
 * A thread whose channel we cannot identify (never stamped, or stamped
 * with a number that was since reconnected under a new id) is only
 * gated when the account actually owns a Meta number. Without one
 * there is nothing a template could be sent through, so asking for a
 * template just blocks the agent for no reason.
 */
export function conversationHasNoSessionWindow(
  whatsappConfigId: string | null | undefined,
  providerByConfigId: Record<string, string | undefined>,
): boolean {
  const provider = whatsappConfigId
    ? providerByConfigId[whatsappConfigId]
    : undefined;
  if (provider) return provider === 'evolution';

  const known = Object.values(providerByConfigId).filter(Boolean);
  return !known.some((p) => p !== 'evolution');
}
