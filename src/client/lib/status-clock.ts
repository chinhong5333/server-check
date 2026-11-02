/** Longest a poll can reasonably take; older data may just be a hidden tab or a failed refresh. */
export const STATUS_DATA_GRACE_MS = 15_000;

/**
 * The clock for deciding from fetched data whether an agent is overdue or stale. Once the data is old it returns the
 * fetch time, so a paused tab or failed poll cannot report a missed heartbeat the server never saw. Omit fetchedAt to
 * use the live clock.
 */
export function statusClock(fetchedAt: number | null | undefined, now = Date.now()): number {
  return fetchedAt != null && now - fetchedAt > STATUS_DATA_GRACE_MS ? fetchedAt : now;
}
