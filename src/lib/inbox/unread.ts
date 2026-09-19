/** Sum of unread messages (WhatsApp-style tab / row counts). */
export function sumUnread(values: Iterable<number>): number {
  let sum = 0;
  for (const n of values) {
    if (n > 0) sum += n;
  }
  return sum;
}

export function formatUnreadBadge(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
