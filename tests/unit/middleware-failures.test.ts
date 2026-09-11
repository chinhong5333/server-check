import { expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { advanceMiddlewareFailures } from "../../src/server/services/middleware-failures";
import { updateAgentBodySchema } from "../../src/shared/contracts";
it("persists a streak across calls and resets on successful or disabled checks",async()=>{
  let count=0;
  const execute=vi.fn(async(sql:string,values:unknown[])=>{
    if(sql.startsWith("SELECT"))return [[{middleware_failure_threshold:3,middleware_failure_count:count}]];
    count=Number(values[0]);return [{affectedRows:1}];
  });
  const connection={execute} as unknown as PoolConnection;
  for(const expected of [1,2,3]) expect(await advanceMiddlewareFailures(connection,"1","unhealthy")).toEqual({count:expected,threshold:3});
  expect((await advanceMiddlewareFailures(connection,"1","healthy")).count).toBe(0);
  const writesAfterReset=execute.mock.calls.filter(([sql])=>String(sql).startsWith("UPDATE")).length;
  expect((await advanceMiddlewareFailures(connection,"1","healthy")).count).toBe(0);
  expect(execute.mock.calls.filter(([sql])=>String(sql).startsWith("UPDATE"))).toHaveLength(writesAfterReset);
  expect((await advanceMiddlewareFailures(connection,"1","unhealthy")).count).toBe(1);
  expect((await advanceMiddlewareFailures(connection,"1","disabled")).count).toBe(0);
  expect(execute.mock.calls[0][0]).toContain("FOR UPDATE");
});
it("defaults the setting to two and limits it to integer values 1–10",()=>{
  const base={server_name:"test",ram_available_threshold_percent:15,disk_available_threshold_percent:10,load_5_per_core_threshold:1,heartbeat_interval_seconds:120,telegram_alert_cooldown_seconds:900};
  expect(updateAgentBodySchema.parse(base).middleware_failure_threshold).toBe(2);
  for(const value of [0,11,1.5,"2"])expect(updateAgentBodySchema.safeParse({...base,middleware_failure_threshold:value}).success).toBe(false);
});
