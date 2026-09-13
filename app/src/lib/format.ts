/** Shared presentational formatters, kept separate so screens don't reinvent them with drifting behavior. */

/** Rounds to the nearest minute; e.g. "45m", "1h 20m". */
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** File sizes shown alongside media editions. */
export function formatMediaSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
