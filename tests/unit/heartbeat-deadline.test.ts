import { describe, expect, it } from "vitest";
import { heartbeatDeadline, isHeartbeatOverdue } from "../../src/server/services/heartbeat-deadline.js";

describe("heartbeat deadline", () => {
  it("uses only the interval with no grace period", () => {
    const receivedAt = Date.UTC(2026, 8, 1, 12, 0, 0);
    expect(heartbeatDeadline(receivedAt, 120)).toBe(Date.UTC(2026, 8, 1, 12, 2, 0));
    expect(isHeartbeatOverdue(Date.UTC(2026, 8, 1, 12, 1, 59), receivedAt, 120)).toBe(false);
    expect(isHeartbeatOverdue(Date.UTC(2026, 8, 1, 12, 2, 0), receivedAt, 120)).toBe(true);
  });

  it("resets the full interval from every received heartbeat", () => {
    const nextHeartbeat = Date.UTC(2026, 8, 1, 12, 1, 20);
    expect(heartbeatDeadline(nextHeartbeat, 120)).toBe(Date.UTC(2026, 8, 1, 12, 3, 20));
  });
});
