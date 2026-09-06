import { FileJson, X } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentIncidentLog } from "../../shared/contracts";
import { CopyButton } from "./CopyButton";
import { DateTimeStamp } from "./DateTimeStamp";
import { ModalDialog } from "./ModalDialog";
import { formatIdentifierLabel } from "../lib/format";

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
                    {formatIdentifierLabel(incident.incident_type)}
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
