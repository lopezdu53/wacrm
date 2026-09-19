"use client";

import { createContext, useContext } from "react";

/** Lets full-screen chats hide the WhatsApp-style bottom tab bar. */
export const DashboardNavContext = createContext<{
  setMobileChatOpen: (open: boolean) => void;
  viewingConversationId: string | null;
  setViewingConversationId: (id: string | null) => void;
  viewingInternalChannelId: string | null;
  setViewingInternalChannelId: (id: string | null) => void;
}>({
  setMobileChatOpen: () => {},
  viewingConversationId: null,
  setViewingConversationId: () => {},
  viewingInternalChannelId: null,
  setViewingInternalChannelId: () => {},
});

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
