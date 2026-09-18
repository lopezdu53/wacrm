import { hasMinRole, type AccountRole, isAccountRole } from "@/lib/auth/roles";

export interface NewMessageMember {
  user_id: string;
  account_role: string | null;
  restrict_to_assigned: boolean | null;
}

/**
 * Who should hear about a new inbound WhatsApp message.
 *
 *  - Assigned thread → the assignee + anyone following the conversation.
 *  - Unassigned thread → every owner/admin/agent who is not restricted
 *    to assigned-only, plus followers.
 *  - Viewers never get a ping (read-only).
 */
export function resolveNewMessageRecipients(args: {
  assignedAgentId: string | null;
  followerIds: string[];
  members: NewMessageMember[];
}): string[] {
  const ids = new Set<string>();
  const assigned = args.assignedAgentId?.trim() || null;

  if (assigned) ids.add(assigned);
  for (const id of args.followerIds) {
    if (id) ids.add(id);
  }

  if (!assigned) {
    for (const member of args.members) {
      if (!member.user_id) continue;
      if (!isAccountRole(member.account_role)) continue;
      const role = member.account_role as AccountRole;
      if (!hasMinRole(role, "agent")) continue;
      if (member.restrict_to_assigned) continue;
      ids.add(member.user_id);
    }
  }

  return [...ids];
}

export function previewInboundBody(
  contentText: string | null | undefined,
  contentType: string,
  max = 140,
): string {
  const text = (contentText ?? "").replace(/\s+/g, " ").trim();
  if (text) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }
  switch (contentType) {
    case "image":
      return "Sent a photo";
    case "audio":
      return "Sent a voice note";
    case "video":
      return "Sent a video";
    case "document":
      return "Sent a document";
    case "location":
      return "Sent a location";
    case "interactive":
      return "Sent a reply";
    default:
      return "New WhatsApp message";
  }
}

/** Push services return 404/410 when the endpoint is gone — drop the row. */
export function shouldDropPushSubscription(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
