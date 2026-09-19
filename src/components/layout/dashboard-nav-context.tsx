"use client";

import { createContext, useContext } from "react";

/** Lets full-screen chats hide the WhatsApp-style bottom tab bar. */
export const DashboardNavContext = createContext<{
  setMobileChatOpen: (open: boolean) => void;
  viewingConversationId: string | null;
  setViewingConversationId: (id: string | null) => void;
  viewingInternalChannelId: string | null;
  setViewingInternalChannelId: (id: string | null) => void;
  inboxUnread: number;
  setInboxUnread: (n: number) => void;
}>({
  setMobileChatOpen: () => {},
  viewingConversationId: null,
  setViewingConversationId: () => {},
  viewingInternalChannelId: null,
  setViewingInternalChannelId: () => {},
  inboxUnread: 0,
  setInboxUnread: () => {},
});

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
