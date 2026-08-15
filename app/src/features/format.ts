/** Shared presentational formatters, kept separate so screens don't reinvent them with drifting behavior. */

/** Rounds to the nearest minute; e.g. "45m", "1h 20m". */
export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
