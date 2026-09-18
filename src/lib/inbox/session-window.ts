/**
 * Meta Cloud API enforces a 24-hour customer-care window (free-form
 * text only after the contact writes; otherwise a template).
 * Evolution / WhatsApp Web has no such window — agents can always reply.
 *
 * This must be decided per conversation (the channel that owns the
 * thread), not per account. An account that also has a Meta number
 * must not lock Evolution inboxes behind a template.
 */
export function conversationHasNoSessionWindow(
  whatsappConfigId: string | null | undefined,
  providerByConfigId: Record<string, string | undefined>,
): boolean {
  if (!whatsappConfigId) return false;
  return providerByConfigId[whatsappConfigId] === 'evolution';
}
