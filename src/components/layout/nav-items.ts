import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Bot,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Radio,
  Target,
  Settings,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

export interface AppNavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  beta?: boolean;
}

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/opportunities", labelKey: "opportunities", icon: Target },
  { href: "/internal-chat", labelKey: "internalChat", icon: MessagesSquare },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  { href: "/automations", labelKey: "automations", icon: Zap },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

export const SETTINGS_NAV_ITEM: AppNavItem = {
  href: "/settings",
  labelKey: "settings",
  icon: Settings,
};

/** Main-nav entries an agent/viewer may see. */
export const RESTRICTED_NAV_HREFS = new Set([
  "/inbox",
  "/opportunities",
  "/internal-chat",
  "/notifications",
]);

export const MOBILE_TAB_HREFS = [
  "/inbox",
  "/opportunities",
  "/internal-chat",
  "/notifications",
] as const;
