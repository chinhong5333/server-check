import { Activity, Database, FileJson, HardDrive, Link2, RotateCcw, Server, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentIncidentLog } from "../../shared/contracts";
import { CopyButton } from "./CopyButton";
import { DateTimeStamp } from "./DateTimeStamp";
import { ModalDialog } from "./ModalDialog";
import { formatIdentifierLabel } from "../lib/format";

/** Icon tile for an incident row, chosen from the incident type identifier. */
function incidentTile(type: string) {
  if (type.includes("heartbeat")) return { Icon: Activity, tone: "warning" };
  if (type.includes("database")) return { Icon: Database, tone: "critical" };
  if (type.includes("middleware")) return { Icon: Link2, tone: "violet" };
  if (type.includes("restart")) return { Icon: RotateCcw, tone: "accent" };
  if (/ram|memory|disk|storage|load|cpu|resource/.test(type)) return { Icon: HardDrive, tone: "violet" };
  if (/service|apache|nginx/.test(type)) return { Icon: Server, tone: "critical" };
  return { Icon: TriangleAlert, tone: "warning" };
}

export function AgentIncidentHistory({
  incidents
}: {
  incidents: AgentIncidentLog[];
}) {
  const rawLogTriggerRef = useRef<HTMLButtonElement>(null);
  const [selectedIncident, setSelectedIncident] = useState<AgentIncidentLog | null>(null);
  const rawLog = selectedIncident ? JSON.stringify(selectedIncident, null, 2) : "";

  return (
    <section className="data-surface" aria-labelledby="agent-incidents-title">
      <div className="section-heading">
        <div>
          <h2 id="agent-incidents-title">Incident History</h2>
          <p>Conditions recorded for this agent, with the newest occurrence first.</p>
        </div>
        <span className="numeric section-count">Total {incidents.length}</span>
      </div>

      {incidents.length === 0 ? (
        <p className="quiet-message">No incidents have been recorded for this agent.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table incident-history-table">
            <thead>
              <tr>
                <th scope="col">Incident</th>
                <th scope="col">Details</th>
                <th scope="col">Occurred At</th>
                <th scope="col"><span className="visually-hidden">Raw Log</span></th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <th scope="row" data-label="Incident" className="mono-label">
                    <IncidentType type={incident.incident_type} />
                  </th>
                  <td data-label="Details">{incident.probable_cause}</td>
                  <td data-label="Occurred At" className="numeric">
                    <DateTimeStamp value={incident.opened_at} />
                  </td>
                  <td data-label="Raw Log" className="row-action incident-log-action">
                    <button
                      className="button button--secondary"
                      type="button"
                      aria-haspopup="dialog"
                      aria-controls="incident-raw-log"
                      onClick={(event) => {
                        rawLogTriggerRef.current = event.currentTarget;
                        setSelectedIncident(incident);
                      }}
                    >
                      <FileJson aria-hidden="true" />
                      View Raw Log
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalDialog
        id="incident-raw-log"
        open={selectedIncident !== null}
        labelledBy="incident-raw-log-title"
        describedBy="incident-raw-log-description"
        dialogClassName="agent-dialog--raw-log"
        surfaceClassName="agent-dialog__surface form-surface raw-log-dialog"
        restoreFocusTo={rawLogTriggerRef.current}
      >
        {selectedIncident ? (
          <>
            <div className="section-heading">
              <div>
                <h2 id="incident-raw-log-title">Incident Raw Log</h2>
                <p id="incident-raw-log-description">
                  Complete normalized record for {selectedIncident.incident_type.replaceAll("_", " ")}.
                </p>
              </div>
              <button
                data-dialog-initial-focus
                className="icon-button"
                type="button"
                aria-label="Close Incident Raw Log"
                onClick={() => setSelectedIncident(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="code-surface raw-log-dialog__code">
              <div className="code-surface__header">
                <strong>{selectedIncident.id}.json</strong>
                <CopyButton value={rawLog} label="Copy Raw Log" />
              </div>
              <pre tabIndex={0}><code>{rawLog}</code></pre>
            </div>
          </>
        ) : null}
      </ModalDialog>
    </section>
  );
}

function IncidentType({ type }: { type: string }) {
  const { Icon, tone } = incidentTile(type);
  return <span className="incident-type">
    <span className={`status-tile status-tile--sm status-tile--${tone}`} aria-hidden="true"><Icon /></span>
    <span>{formatIdentifierLabel(type)}</span>
  </span>;
}
