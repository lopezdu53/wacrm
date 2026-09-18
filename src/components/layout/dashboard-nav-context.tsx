"use client";

import { createContext, useContext } from "react";

/** Lets the mobile inbox list open the app drawer after the global
 *  header is hidden (WhatsApp-style full-screen chats). */
export const DashboardNavContext = createContext<{
  openSidebar: () => void;
}>({ openSidebar: () => {} });

export function useDashboardNav() {
  return useContext(DashboardNavContext);
}
