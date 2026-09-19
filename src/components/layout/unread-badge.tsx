import { formatUnreadBadge } from "@/lib/inbox/unread";

/**
 * WhatsApp-green unread pill. Inline colors so a missing Tailwind
 * utility cannot hide the number on the phone.
 */
export function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const label = formatUnreadBadge(Number(count) || 0);
  if (!label) return null;

  return (
    <span
      className={className}
      data-unread-badge={label}
      style={{
        display: "inline-flex",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        height: 20,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 999,
        backgroundColor: "#25D366",
        color: "#ffffff",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        zIndex: 1,
      }}
    >
      {label}
    </span>
  );
}
