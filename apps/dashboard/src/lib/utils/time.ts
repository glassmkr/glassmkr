/** Returns a human-readable relative time string, e.g. "2m ago", "3h ago", "5d ago". */
export function timeAgo(dateStr: string, nowMs?: number): string {
  // nowMs lets a caller measure against a reference clock instead of the
  // wall clock: the demo renders ages relative to its capture timestamp, so
  // a recorded sample reads as deliberately captured rather than abandoned.
  const now = nowMs ?? Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Formats seconds into a human-readable uptime string, e.g. "3d 4h 12m". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(" ");
}

/** Formats megabytes into a readable string, e.g. "1.2 GB" or "512 MB". */
export function formatBytes(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

/** Formats a decimal value as a percentage string, e.g. "45.2%". */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
