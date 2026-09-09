import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),record:vi.fn(),resolve:vi.fn()}));
vi.mock("../../src/server/db",()=>({getPool:()=>({query:mocks.query}),withTransaction:async(_config:unknown,fn:(conn:unknown)=>Promise<unknown>)=>fn({execute:mocks.execute})}));
vi.mock("../../src/server/services/incidents",()=>({recordAgentCondition:mocks.record,resolveAgentCondition:mocks.resolve}));
import { scanMissedHeartbeats } from "../../src/server/workers";
beforeEach(()=>{vi.clearAllMocks();});
describe("heartbeat alert collector",()=>{
  const candidate={id:"1",public_id:"agent-1",project_id:"2",server_name:"Synthetic",project_name:"Test",last_heartbeat_at:null,created_at:Date.now()-120000,heartbeat_interval_seconds:60};
  it("collects another overdue observation even when an incident already exists",async()=>{
    mocks.query.mockResolvedValue([[candidate]]);mocks.execute.mockImplementation(async(sql:string)=>sql.includes("FOR UPDATE")?[[candidate]]:[{affectedRows:1}]);
    await scanMissedHeartbeats({} as AppConfig);await scanMissedHeartbeats({} as AppConfig);
    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.objectContaining({type:"heartbeat_missed"}),expect.any(Number));
  });
  it("does not create a false overdue error after a heartbeat arrives during selection",async()=>{
    mocks.query.mockResolvedValue([[candidate]]);mocks.execute.mockResolvedValue([[{...candidate,last_heartbeat_at:Date.now()}]]);
    await scanMissedHeartbeats({} as AppConfig);expect(mocks.record).not.toHaveBeenCalled();
  });
  it("collects Awaiting Data while a new agent is still within its initial interval",async()=>{
    const fresh={...candidate,created_at:Date.now()};mocks.query.mockResolvedValue([[fresh]]);mocks.execute.mockResolvedValue([[fresh]]);
    await scanMissedHeartbeats({} as AppConfig);
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.objectContaining({type:"awaiting_first_heartbeat"}),expect.any(Number));
  });
});
