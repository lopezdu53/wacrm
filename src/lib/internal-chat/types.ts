// Shared types for the internal team chat (DMs + groups).

export interface ChannelMemberLite {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface InternalChannel {
  id: string;
  kind: "dm" | "group";
  /** Group name; null for DMs (labelled by the other member). */
  name: string | null;
  created_by: string | null;
  last_message_at: string | null;
  members: ChannelMemberLite[];
  last_message: {
    content: string;
    created_at: string;
    sender_id: string;
  } | null;
  unread_count: number;
}

export interface InternalMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/** Display label for a channel from the current user's perspective. */
export function channelLabel(
  channel: Pick<InternalChannel, "kind" | "name" | "members">,
  currentUserId: string,
): string {
  if (channel.kind === "group") return channel.name || "Grupo";
  const other = channel.members.find((m) => m.user_id !== currentUserId);
  return other?.full_name || other?.user_id || "Chat";
}
