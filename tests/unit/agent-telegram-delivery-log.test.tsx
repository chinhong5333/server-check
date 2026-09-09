// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const media = vi.hoisted(() => ({ mobile: false }));
vi.mock("../../src/client/hooks/useMediaQuery", () => ({ useMediaQuery: () => media.mobile }));
import { AgentTelegramDeliveryLog } from "../../src/client/components/AgentTelegramDeliveryLog";
afterEach(cleanup);
beforeEach(() => { media.mobile = false; });
it("does not attribute automatic recovery cancellation to an administrator",()=>{
  render(<AgentTelegramDeliveryLog deliveries={[{id:"1",event_type:"opened",incident_type:"telemetry_invalid",probable_cause:"Invalid telemetry",
    status:"cancelled",attempt_count:0,queued_at:1,next_attempt_at:1,sent_at:null,last_error:null}]} />);
  expect(screen.getAllByText("Cancelled")).toHaveLength(2);
  expect(screen.queryByText("Cancelled By Admin")).not.toBeInTheDocument();
  expect(screen.queryByText("Next Attempt")).not.toBeInTheDocument();
});
it("groups mobile event, attempts, status, incident and timing without repeating table labels",()=>{
  media.mobile=true;
  render(<AgentTelegramDeliveryLog deliveries={[{id:"1",event_type:"opened",incident_type:"heartbeat_missed",probable_cause:"Heartbeat overdue",
    status:"pending",attempt_count:1,queued_at:1788930000000,next_attempt_at:1788930300000,sent_at:null,last_error:"Telegram returned HTTP 400."}]} />);
  expect(screen.getByRole("list",{name:"Telegram Deliveries"})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"Heartbeat Missed"})).toBeInTheDocument();
  expect(screen.getByText("1 Attempt")).toBeInTheDocument();
  expect(screen.getByText("Pending")).toBeInTheDocument();
  expect(screen.getByText("Queued At")).toBeInTheDocument();
  expect(screen.getByText("Next Attempt")).toBeInTheDocument();
  expect(screen.getByText("Telegram returned HTTP 400.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it.each(["sent","failed","cancelled"] as const)("preserves mobile %s delivery information",status=>{
  media.mobile=true;
  render(<AgentTelegramDeliveryLog deliveries={[{id:"1",event_type:"resolved",incident_type:"heartbeat_missed",probable_cause:"Heartbeat recovered",
    status,attempt_count:2,queued_at:1788930000000,next_attempt_at:1788930300000,sent_at:status==="sent"?1788930200000:null,last_error:null}]} />);
  expect(screen.getByText("Recovery")).toBeInTheDocument();
  expect(screen.getByText("2 Attempts")).toBeInTheDocument();
  expect(screen.getAllByText(status==="sent"?"Delivered":status==="failed"?"No More Retries":"Cancelled").length).toBeGreaterThan(0);
  expect(screen.queryByText("Next Attempt")).not.toBeInTheDocument();
});
