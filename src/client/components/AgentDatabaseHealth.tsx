import { useRef, useState } from "react";
import { CircleCheck, CircleDashed, CircleX, Clock3, Database, FileJson, X } from "lucide-react";
import type { DatabaseHealthSnapshot } from "../../shared/contracts";
import { CopyButton } from "./CopyButton";
import { ModalDialog } from "./ModalDialog";
import { intlLocale, perLocale, t } from "../i18n";

const integerFormat = perLocale(() => new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 }));

function count(value: number | null): string {
  return value === null ? "--" : integerFormat().format(value);
}

function databaseSize(mebibytes: number | null): string {
  if (mebibytes === null) return "--";
  if (mebibytes >= 1024) return `${(mebibytes / 1024).toFixed(2)} GiB`;
  return `${mebibytes.toFixed(1)} MiB`;
}

export function AgentDatabaseHealth({ snapshot, stale, monitored }: {
  snapshot: DatabaseHealthSnapshot | null;
  stale: boolean;
  monitored: boolean;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const rawTriggerRef = useRef<HTMLButtonElement>(null);
  const rawResponse = monitored && snapshot?.raw ? JSON.stringify(snapshot.raw, null, 2) : null;
  const alive = snapshot?.status.toLowerCase() === "alive";
  const connectionCapacity = snapshot !== null && snapshot.connection_count !== null && snapshot.connection_max !== null
    && snapshot.connection_max > 0;
  const connectionPercent = connectionCapacity
    ? snapshot.connection_count! * 100 / snapshot.connection_max!
    : null;
  const availableConnections = connectionCapacity
    ? Math.max(0, snapshot.connection_max! - snapshot.connection_count!)
    : null;
  const status = !monitored
    ? { label: t("Not Monitored"), tone: "new", Icon: CircleDashed }
    : snapshot === null
    ? { label: t("No Data"), tone: "new", Icon: CircleDashed }
    : stale
    ? { label: t("Stale"), tone: "stale", Icon: Clock3 }
    : alive
      ? { label: t("Alive"), tone: "healthy", Icon: CircleCheck }
      : { label: t("Unavailable"), tone: "critical", Icon: CircleX };

  return <>
  <section className="agent-database-health" aria-labelledby="agent-database-health-title">
    <header className="agent-database-health__header">
      <div className="agent-database-health__identity">
        <Database aria-hidden="true" />
        <h3 id="agent-database-health-title">{t("Database Health")}</h3>
        <span className="agent-database-health__source">{t("Reported by the Middleware API")}</span>
      </div>
      <div className="agent-database-health__tools">
        <span className={`status status--${status.tone}`}><status.Icon aria-hidden="true" />{status.label}</span>
        <button ref={rawTriggerRef} className="button button--secondary agent-database-health__raw-button"
          type="button" aria-haspopup="dialog" aria-controls="database-raw-response"
          onClick={() => setRawOpen(true)}><FileJson aria-hidden="true" />{t("View Raw DB Response")}</button>
      </div>
    </header>

    {!monitored ? <div className="agent-database-health__empty" role="status">
      <CircleDashed aria-hidden="true" />
      <div>
        <strong>{t("Database Not Monitored")}</strong>
        <p>{t("Enable Middleware API monitoring and install the latest generated agent script to collect database information.")}</p>
      </div>
    </div> : snapshot === null ? <div className="agent-database-health__empty" role="status">
      <CircleDashed aria-hidden="true" />
      <div>
        <strong>{t("No Database Data")}</strong>
        <p>{t("The latest agent report did not include database information from the Middleware API.")}</p>
      </div>
    </div> : !alive ? <div className="agent-database-health__error" role="status">
      <CircleX aria-hidden="true" />
      <div>
        <strong>{t("Database Check Failed")}</strong>
        <p>{snapshot.message.trim() ? t(snapshot.message.trim()) : t("The Middleware API reported that the database is unavailable.")}</p>
      </div>
    </div> : <div className="agent-database-health__body">
      <div className="agent-database-capacity">
        <div className="agent-database-capacity__heading">
          <div>
            <span className="agent-database-capacity__label">{stale ? t("Last Reported Connections") : t("Current Connections")}</span>
            <div className="agent-database-capacity__value">
              <strong>{count(snapshot.connection_count)}</strong>
              <span>/ {count(snapshot.connection_max)}</span>
            </div>
          </div>
          <span className="agent-database-capacity__percent">
            {connectionPercent === null ? "--" : `${connectionPercent.toFixed(1)}%`}
          </span>
        </div>
        {connectionCapacity ? <progress className="agent-database-capacity__meter"
          aria-label={t("{0}% of database connection capacity in use", connectionPercent!.toFixed(1))}
          max={snapshot.connection_max!} value={snapshot.connection_count!} /> : null}
        <div className="agent-database-capacity__footer">
          <span>{stale ? t("Last Reported Capacity") : t("Connection Capacity")}</span>
          <span>{availableConnections === null ? t("Not Reported") : stale
            ? t("{0} Available at Last Report", count(availableConnections))
            : t("{0} Available", count(availableConnections))}</span>
        </div>
      </div>
      <dl className="agent-database-health__metrics">
        <div><dt>{t("Threads Running")}</dt><dd>{count(snapshot.threads_running)}</dd><span>{stale ? t("Last Reported") : t("Active Now")}</span></div>
        <div><dt>{t("Peak Connections")}</dt><dd>{count(snapshot.peak_connections)}</dd><span>{t("Recorded Peak")}</span></div>
        <div><dt>{t("Long Queries")}</dt><dd>{count(snapshot.long_queries)}</dd><span>{stale ? t("Last Reported") : snapshot.long_queries === 0 ? t("None Detected") : t("Reported")}</span></div>
        <div><dt>{t("Database Size")}</dt><dd>{databaseSize(snapshot.db_size_mb)}</dd><span>{stale ? t("Last Reported") : t("Current Size")}</span></div>
      </dl>
    </div>}
  </section>
  <ModalDialog id="database-raw-response" open={rawOpen} labelledBy="database-raw-response-title"
    describedBy="database-raw-response-description" dialogClassName="agent-dialog--raw-log"
    surfaceClassName="agent-dialog__surface form-surface raw-log-dialog"
    restoreFocusTo={rawTriggerRef.current}>
    <div className="section-heading">
      <div>
        <h2 id="database-raw-response-title">{t("Raw DB Response")}</h2>
        <p id="database-raw-response-description">{t("Latest db object reported by the Middleware API.")}</p>
      </div>
      <button data-dialog-initial-focus className="icon-button" type="button"
        aria-label={t("Close Raw DB Response")} onClick={() => setRawOpen(false)}><X aria-hidden="true" /></button>
    </div>
    {rawResponse ? <div className="code-surface raw-log-dialog__code">
      <div className="code-surface__header">
        <strong>db.json</strong>
        <CopyButton value={rawResponse} label={t("Copy Raw DB Response")} />
      </div>
      <pre tabIndex={0}><code>{rawResponse}</code></pre>
    </div> : <div className="raw-db-empty" role="status">
      <FileJson aria-hidden="true" />
      <strong>{t("No Raw DB Response")}</strong>
      <p>{monitored
        ? t("The latest agent report did not include a raw db object.")
        : t("Middleware API monitoring is disabled in the latest generated agent script.")}</p>
    </div>}
  </ModalDialog>
  </>;
}
