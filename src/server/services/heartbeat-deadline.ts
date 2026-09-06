export function heartbeatDeadline(receivedAt: number, intervalSeconds: number): number {
  if (!Number.isFinite(receivedAt) || receivedAt < 0) {
    throw new Error("receivedAt must be a non-negative finite timestamp.");
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("intervalSeconds must be a positive integer.");
  }
  return receivedAt + intervalSeconds * 1000;
}

export function isHeartbeatOverdue(
  now: number,
  receivedAt: number,
  intervalSeconds: number
): boolean {
  return now >= heartbeatDeadline(receivedAt, intervalSeconds);
}
