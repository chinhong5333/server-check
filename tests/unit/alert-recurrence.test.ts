import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import type { TelemetryPayload } from "../../src/shared/contracts";
import { evaluateTelemetryIncidents, recordAgentCondition, resolveAgentCondition } from "../../src/server/services/incidents";
import { alertKey } from "../../src/server/services/alert-queue";

const policy = { agentInternalId:"1",agentPublicId:"agent-1",serverName:"Synthetic",projectInternalId:"1",projectName:"Test",ramThreshold:15,diskThreshold:10,loadThreshold:1 };
const healthy: TelemetryPayload = {
  sequence_id:1,observed_at:1,agent_version:"1.3.0",
  health_probe:{checked_at:1,outcome:"healthy",http_status_code:200,latency_ms:10,error_code:null,error_message:null},
  metrics:{cpu_count:1,load_1:0,load_5:0,load_15:0,memory_total_bytes:100,memory_available_bytes:80,swap_total_bytes:0,swap_free_bytes:0,uptime_seconds:100},
  filesystems:[],top_processes:[],service_checks:{apache:{service_name:"apache2",status:"active"},nginx:{service_name:"nginx",status:"active"}}
};
function store() {
  const incidents: Array<{id:string;public_id:string;agent_id:string;incident_type:string;status:string}> = [];
  const messages: Array<{id:string;incident_id:string;event:string;status:string;key:string|null;payload:Record<string,unknown>}> = [];
  const execute = vi.fn(async (sql:string, values:unknown[] = []) => {
    if (sql.startsWith("SELECT") && sql.includes("FROM incidents")) return [incidents.filter(i=>i.agent_id===String(values[0])&&i.status==="open"&&(!sql.includes("incident_type = ?")||i.incident_type===values[1]))];
    if (sql.includes("INSERT INTO incidents")) {const id=String(incidents.length+1);incidents.push({id,public_id:String(values[0]),agent_id:String(values[2]),incident_type:String(values[3]),status:"open"});return [{insertId:Number(id)}];}
    if (sql.includes("UPDATE incidents")) {if(sql.includes("status = 'resolved'")) incidents.find(i=>i.id===String(values[2]))!.status="resolved";return [{affectedRows:1}];}
    if (sql.startsWith("SELECT") && sql.includes("FROM notification_outbox")) return [messages.filter(m=>m.incident_id===String(values[0])&&m.event===values[1]&&m.status==="pending"&&(m.key===values[2]||m.key===null)).slice(0,1)];
    if (sql.includes("INSERT INTO notification_outbox")) {messages.push({id:String(messages.length+1),incident_id:String(values[1]),event:String(values[2]),payload:JSON.parse(String(values[3])),key:String(values[4]),status:"pending"});return [{insertId:messages.length}];}
    if (sql.includes("UPDATE notification_outbox SET payload_json")) {const m=messages.find(m=>m.id===values[3])!;m.payload=JSON.parse(String(values[0]));m.key=String(values[1]);return [{affectedRows:1}];}
    if (sql.includes("UPDATE notification_outbox SET status = 'cancelled'")) {messages.filter(m=>m.incident_id===String(values[1])&&m.event==="opened"&&m.status==="pending").forEach(m=>m.status="cancelled");return [{affectedRows:1}];}
    throw new Error(`Unexpected test query: ${sql}`);
  });
  return {connection:{execute} as unknown as PoolConnection,incidents,messages};
}
describe("recurring condition collection",()=>{
  it("waits for the middleware failure threshold, reminds after opening, and recovers normally",async()=>{
    const s=store();const payload={...healthy,health_probe:{...healthy.health_probe,outcome:"unhealthy" as const,http_status_code:null,error_code:"timeout"}};
    for(const count of [1,2]) {
      const snapshot=await evaluateTelemetryIncidents(s.connection,{...policy,middlewareFailures:{count,threshold:3}},payload,count);
      expect(snapshot.status).toBe("warning");expect(snapshot.probableCause).toContain(`(${count}/3)`);
    }
    expect(s.incidents).toHaveLength(0);expect(s.messages).toHaveLength(0);
    await evaluateTelemetryIncidents(s.connection,{...policy,middlewareFailures:{count:3,threshold:3}},payload,3);
    expect(s.incidents).toHaveLength(1);expect(s.messages).toHaveLength(1);
    expect(s.messages[0].payload.details).toMatchObject({consecutive_failures:3,failure_threshold:3});
    s.messages[0].status="sent";
    await evaluateTelemetryIncidents(s.connection,{...policy,middlewareFailures:{count:1,threshold:10}},payload,4);
    expect(s.messages).toHaveLength(2);
    await evaluateTelemetryIncidents(s.connection,{...policy,middlewareFailures:{count:0,threshold:10}},healthy,5);
    expect(s.incidents[0].status).toBe("resolved");
    expect(s.messages[1].status).toBe("cancelled");
    expect(s.messages[2].event).toBe("resolved");
  });
  it("does not send recovery for a transient failure that never opened an incident",async()=>{
    const s=store();
    await evaluateTelemetryIncidents(s.connection,{...policy,middlewareFailures:{count:1,threshold:2}},
      {...healthy,health_probe:{...healthy.health_probe,outcome:"unhealthy",http_status_code:502,error_code:"http_status_error"}},1);
    await evaluateTelemetryIncidents(s.connection,{...policy,middlewareFailures:{count:0,threshold:2}},healthy,2);
    expect(s.incidents).toHaveLength(0);expect(s.messages).toHaveLength(0);
  });
  it("keeps one pending error, then requeues after delivery without opening another incident",async()=>{
    const s=store();const payload={...healthy,service_checks:{...healthy.service_checks,nginx:{service_name:"nginx",status:"inactive" as const}}};
    await evaluateTelemetryIncidents(s.connection,policy,payload,1);
    await evaluateTelemetryIncidents(s.connection,policy,payload,2);
    expect(s.messages).toHaveLength(1);expect(s.messages[0].payload.observed_at).toBe(2);
    s.messages[0].status="sent";
    await evaluateTelemetryIncidents(s.connection,policy,payload,3);
    expect(s.messages).toHaveLength(2);expect(s.incidents).toHaveLength(1);
  });
  it("collects different middleware errors separately while deduplicating changing latency",async()=>{
    const s=store();
    for(const [status,latency] of [[502,10],[503,20],[503,30]]) await evaluateTelemetryIncidents(s.connection,policy,
      {...healthy,health_probe:{...healthy.health_probe,outcome:"unhealthy",http_status_code:status,latency_ms:latency,error_code:"http_status_error"}},latency);
    expect(s.messages).toHaveLength(2);expect(s.incidents).toHaveLength(1);
  });
  it("collects every active warning/critical condition, not just the primary status",async()=>{
    const s=store();const payload:TelemetryPayload={...healthy,metrics:{...healthy.metrics,memory_available_bytes:1,load_5:3},
      filesystems:[{filesystem:"root",mount_point:"/",total_bytes:100,available_bytes:1,inode_used_percent:null}],
      health_probe:{...healthy.health_probe,outcome:"unhealthy",http_status_code:502,error_code:"http_status_error"},
      service_checks:{apache:{service_name:"apache2",status:"inactive"},nginx:{service_name:"nginx",status:"unknown"}}};
    expect((await evaluateTelemetryIncidents(s.connection,policy,payload,1)).status).toBe("critical");
    await evaluateTelemetryIncidents(s.connection,policy,payload,2);
    expect(new Set(s.incidents.map(i=>i.incident_type))).toEqual(new Set(["ram_low","disk_low","load_high","health_api_unhealthy","apache_inactive","nginx_unknown"]));
    expect(s.messages).toHaveLength(6);
  });
  it("cancels pending errors on recovery and queues one recovery only",async()=>{
    const s=store();const condition={type:"telemetry_invalid",severity:"warning" as const,probableCause:"Invalid telemetry",details:{validation_error:"metrics.load_5: invalid"}};
    await recordAgentCondition(s.connection,policy,condition,1);s.messages[0].status="sent";
    await recordAgentCondition(s.connection,policy,condition,2);
    expect((await evaluateTelemetryIncidents(s.connection,policy,healthy,3)).status).toBe("healthy");
    await evaluateTelemetryIncidents(s.connection,policy,healthy,4);
    expect(s.messages.map(m=>[m.event,m.status])).toEqual([["opened","sent"],["opened","cancelled"],["resolved","pending"]]);
  });
  it("deduplicates missing/invalid telemetry and resolves it only on a valid report",async()=>{
    const s=store();
    for(const type of ["telemetry_missing","telemetry_invalid"]) for(let n=0;n<2;n++) await recordAgentCondition(s.connection,policy,{type,severity:"warning",probableCause:type,details:{}},n);
    expect(s.messages).toHaveLength(2);
    await evaluateTelemetryIncidents(s.connection,policy,healthy,10);
    expect(s.incidents.every(i=>i.status==="resolved")).toBe(true);
    expect(s.messages.filter(m=>m.event==="resolved")).toHaveLength(2);
  });
  it("does not merge equal errors from different agents",async()=>{
    const s=store();const condition={type:"heartbeat_missed",severity:"critical" as const,probableCause:"Heartbeat overdue",details:{}};
    await recordAgentCondition(s.connection,policy,condition,1);
    await recordAgentCondition(s.connection,{...policy,agentInternalId:"2",agentPublicId:"agent-2"},condition,1);
    expect(s.messages).toHaveLength(2);expect(s.incidents).toHaveLength(2);
  });
  it("adopts legacy pending entries and permits fresh collection after cancellation/failure",async()=>{
    const s=store();const c={type:"heartbeat_missed",severity:"critical" as const,probableCause:"Heartbeat overdue",details:{}};
    await recordAgentCondition(s.connection,policy,c,1);s.messages[0].key=null;
    await recordAgentCondition(s.connection,policy,c,2);expect(s.messages).toHaveLength(1);expect(s.messages[0].key).not.toBeNull();
    s.messages[0].status="cancelled";await recordAgentCondition(s.connection,policy,c,3);
    s.messages[1].status="failed";await recordAgentCondition(s.connection,policy,c,4);
    expect(s.messages.map(m=>m.status)).toEqual(["cancelled","failed","pending"]);
  });
  it("retires awaiting-data alerts without a false recovery when heartbeat becomes overdue",async()=>{
    const s=store();await recordAgentCondition(s.connection,policy,{type:"awaiting_first_heartbeat",severity:"warning",probableCause:"Awaiting first heartbeat",details:{}},1);
    await resolveAgentCondition(s.connection,policy,"awaiting_first_heartbeat",2,false);
    expect(s.messages.map(m=>m.status)).toEqual(["cancelled"]);
  });
  it("excludes volatile metric values from identity",()=>{
    expect(alertKey("opened",{incident_type:"load_high",probable_cause:"High load",details:{load_5_per_core:2},observed_at:1}))
      .toBe(alertKey("opened",{incident_type:"load_high",probable_cause:"High load",details:{load_5_per_core:3},observed_at:2}));
  });
});
