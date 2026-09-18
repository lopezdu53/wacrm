"use client";

import { createContext, useContext } from "react";

/** Lets full-screen chats hide the WhatsApp-style bottom tab bar. */
export const DashboardNavContext = createContext<{
  setMobileChatOpen: (open: boolean) => void;
}>({ setMobileChatOpen: () => {} });

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
