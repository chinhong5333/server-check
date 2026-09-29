import { expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { preferredMaintenance, readMaintenanceIndicators } from "../../src/server/services/maintenance";

it("batches scope indicators, prioritizes active windows and excludes ended/expired/deleted windows in SQL", async () => {
  const execute = vi.fn().mockResolvedValue([[{ project_id: "1", agent_id: null, starts_at: 2000 },
    { project_id: "1", agent_id: "10", starts_at: 900 }, { project_id: "2", agent_id: null, starts_at: 900 }]]);
  const indicators = await readMaintenanceIndicators({ execute } as unknown as Pool, ["1", "2"], 1000);
  expect(indicators.projects.get("1")).toEqual({ status: "active", scope: "agent" });
  expect(indicators.inherited.get("1")).toEqual({ status: "scheduled", scope: "project" });
  expect(preferredMaintenance(indicators.inherited.get("1")!, indicators.agents.get("10")!)).toEqual({ status: "active", scope: "agent" });
  expect(preferredMaintenance(indicators.inherited.get("2")!, indicators.agents.get("10")!)).toEqual({ status: "active", scope: "project" });
  expect(preferredMaintenance(null, null)).toBeNull();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][1]).toEqual(["1", "2", 1000]);
  expect(execute.mock.calls[0][0]).toContain("w.ended_at IS NULL AND w.ends_at > ?");
  expect(execute.mock.calls[0][0]).toContain("w.is_delete = 0");
  expect(execute.mock.calls[0][0]).toContain("a.is_delete = 0");
});
