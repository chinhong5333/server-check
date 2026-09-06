# Server Monitoring

This context defines the language for a centralized, multi-project service that receives agent heartbeats, retains server telemetry, detects incidents, and alerts internal operators.

## Language

**Project**:
An internal monitoring boundary that owns a set of monitored servers, agents, thresholds, incidents, and history.
_Avoid_: Tenant, workspace

**Monitored Server**:
A server whose liveness, resource pressure, storage, and configured services are observed by an agent.
_Avoid_: Target, node, machine

**Agent**:
An authenticated collector installed on a monitored server and registered to a project.
_Avoid_: Client, probe, script

**White-label Health API**:
The project application endpoint that an agent calls to determine whether the monitored application is responding correctly.
_Avoid_: Central API, agent API, heartbeat endpoint

**Health API URL**:
The agent-specific address of the white-label health API that the agent probes.
_Avoid_: Central API URL, ingestion URL

**Central Ingestion API**:
The central service endpoint that accepts authenticated agent heartbeats, health probe results, and telemetry.
_Avoid_: White-label Health API, monitored API

**Health Probe**:
One agent-initiated request to a white-label health API.
_Avoid_: Heartbeat, central check

**Health Probe Result**:
The structured outcome of a health probe, including health status, response code when available, latency, and a safe error classification.
_Avoid_: Raw response, heartbeat

**Agent Installation Script**:
A generated, self-contained shell artifact for one registered agent, intended to run periodically through cron.
_Avoid_: Agent package, daemon, installer service

**Heartbeat**:
An authenticated call from a registered agent that proves the agent can currently reach the central service, regardless of whether telemetry accompanies the call.
_Avoid_: Metric report, health result

**Heartbeat Interval**:
The maximum permitted elapsed time between two accepted heartbeats for a project.
_Avoid_: Schedule grace, retry window

**Heartbeat Deadline**:
The instant calculated as the most recent accepted heartbeat time plus the project heartbeat interval. Every accepted heartbeat replaces the previous deadline with a new full interval.
_Avoid_: Grace period, fixed cron deadline

**Telemetry Payload**:
The optional structured server measurements and health probe result sent with a heartbeat.
_Avoid_: Heartbeat data, raw command output

**Metric Sample**:
A validated telemetry payload retained as historical data.
_Avoid_: Heartbeat, snapshot

**Monitoring Policy**:
The project-owned configuration that defines the RAM, storage, five-minute load thresholds, and heartbeat interval used to detect incidents.
_Avoid_: Global thresholds, server rules

**Available RAM Percentage**:
The percentage of total RAM that the operating system reports as available for new work without severe memory pressure.
_Avoid_: Free RAM percentage, used RAM

**Available Storage Percentage**:
The percentage of storage capacity still available on a monitored filesystem.
_Avoid_: Disk usage percentage, free disk

**Five-Minute Load Ratio**:
The operating system's five-minute load average divided by the server's logical CPU count, allowing project thresholds to remain comparable across different server sizes.
_Avoid_: CPU percentage, raw load

**Telemetry Staleness**:
A condition where heartbeats continue to arrive but no recent valid metric sample has been accepted.
_Avoid_: Server down, heartbeat failure

**Incident**:
A tracked period in which a project monitoring policy or liveness rule is violated, ending when the condition recovers.
_Avoid_: Notification, alert message
