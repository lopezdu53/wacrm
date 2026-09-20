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
  oppUnread: number;
  setOppUnread: (n: number) => void;
  chatsUnread: number;
  internalUnread: number;
  notificationUnread: number;
}>({
  setMobileChatOpen: () => {},
  viewingConversationId: null,
  setViewingConversationId: () => {},
  viewingInternalChannelId: null,
  setViewingInternalChannelId: () => {},
  inboxUnread: 0,
  setInboxUnread: () => {},
  oppUnread: 0,
  setOppUnread: () => {},
  chatsUnread: 0,
  internalUnread: 0,
  notificationUnread: 0,
});

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
