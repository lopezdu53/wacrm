/**
 * Compact last-message clock for inbox rows (WhatsApp Business style).
 * `now` is injectable so tests do not depend on the wall clock.
 */
export function formatInboxListTime(
  iso: string | null | undefined,
  labels: { yesterday: string },
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const days = localDayDiff(now, date);
  if (days === 0) return formatClock(date);
  if (days === 1) return labels.yesterday;
  return formatShortDate(date);
}

function localDayDiff(now: Date, then: Date): number {
  const ms =
    startOfLocalDay(now).getTime() - startOfLocalDay(then).getTime();
  return Math.round(ms / 86_400_000);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatShortDate(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
}
