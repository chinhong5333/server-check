// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentStateDisplay,
  agentStateCause
} from "../../src/client/components/AgentStateDisplay";

describe("agent state presentation", () => {
  afterEach(cleanup);

  it.each([
    ["healthy", null, null],
    ["healthy", "Heartbeat overdue", null],
    ["new", null, "Awaiting First Heartbeat"],
    ["warning", null, "Warning condition detected"],
    ["critical", null, "Critical condition detected"],
    ["stale", null, "Monitoring data is stale"],
    ["critical", "RAM usage reached 98%", "RAM usage reached 98%"],
    ["warning", "No active condition", "Warning condition detected"]
  ] as const)("maps %s with %s to %s", (status, probableCause, expected) => {
    expect(agentStateCause(status, probableCause)).toBe(expected);
  });

  it("renders a healthy badge without redundant or contradictory supporting text", () => {
    render(<AgentStateDisplay status="healthy" probableCause="Heartbeat overdue" />);

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.queryByText("Heartbeat overdue")).not.toBeInTheDocument();
    expect(screen.queryByText("No active condition")).not.toBeInTheDocument();
  });
});
