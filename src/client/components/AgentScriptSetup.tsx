/* Hallmark · Cobalt operational UI · roomy two-step setup · existing tokens and one-time-secret lifecycle */
import { ArrowLeft, ArrowRight, Check, Download, FileCode2, ListOrdered, SquareTerminal } from "lucide-react";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import type { AgentInstallationResponse } from "../../shared/contracts";
import { buildAgentSetup } from "../lib/agent-setup";
import { CopyButton } from "./CopyButton";
import { HOLD_CONFIRM_SECONDS, HoldConfirmButton } from "./HoldConfirmButton";
import { WizardSteps } from "./WizardSteps";
import { t } from "../i18n";

/** Keeps download filename, cron path and one-line setup command synchronized without changing the embedded credential. */
export function AgentScriptSetup({ installation, compact = false, onDone }: {
  installation: AgentInstallationResponse; compact?: boolean;
  /** Closes the setup once the command has been run; shown on the Run Setup step. */
  onDone?: () => void;
}) {
  const defaultScriptPath = `/root/${installation.script_filename}`;
  const [scriptPath, setScriptPath] = useState(defaultScriptPath);
  const pathInputId = useId();
  const setup = buildAgentSetup(installation.crontab_entry, scriptPath);
  const initialSetupError = buildAgentSetup(installation.crontab_entry, defaultScriptPath).error;
  const [step, setStep] = useState<1 | 2>(1);
  // Exclusive accordion: the one-line command starts open; opening the other view closes it.
  const [commandView, setCommandView] = useState<"one-line" | "separate" | null>("one-line");
  const toggleView = (view: "one-line" | "separate") => (event: SyntheticEvent<HTMLDetailsElement>) => {
    const open = event.currentTarget.open;
    setCommandView(current => open ? view : current === view ? null : current);
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [step]);
  function download() {
    const url = URL.createObjectURL(new Blob([installation.script], { type: "text/x-shellscript" }));
    const link = document.createElement("a"); link.href = url; link.download = setup.filename ?? installation.script_filename;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const scheduleLabel = (setup.scheduleLabel ?? buildAgentSetup(installation.crontab_entry, defaultScriptPath).scheduleLabel)?.toLowerCase();
  const steps = [
    { title: t("Download Script"), hint: t("Save the one-time file") },
    { title: t("Run Setup"), hint: t("Paste one command") }
  ] as const;
  return <div className="agent-script-setup">
    <WizardSteps steps={steps} current={step - 1} label={t("Agent Setup Progress")} />
    <div className="agent-setup-heading"><h3 ref={heading} tabIndex={-1} className={step === 2 ? "visually-hidden" : undefined}>{step === 1 ? t("Download The Agent Script") : t("Run Setup")}</h3>
      {step === 1 ? <p>{t("Save this one-time script, then upload it to the path below on your server.")}</p>
        : <p>{t("Paste it on the server as root. It adds a crontab job that pings the central server {0}.", scheduleLabel ?? t("on its cron schedule"))}</p>}</div>
    {/* The path field and the command it rewrites share one card, so the cause and effect read together. */}
    {step === 2 && <div className="agent-setup-command-card"><div className="field">
      <label htmlFor={pathInputId}>{t("Script Path")}</label>
      <input id={pathInputId} name="script_path" type="text" value={scriptPath} placeholder="/root/myfile.sh" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={1024}
        aria-invalid={Boolean(setup.error)} aria-describedby={setup.error ? `${pathInputId}-error ${pathInputId}-help` : `${pathInputId}-help`} onChange={event => setScriptPath(event.target.value)} />
      <p id={`${pathInputId}-help`} className="field__help">{t("Uploaded the script to a different folder or under another name? Edit the path here. This only updates the command below; it does not move or rename the file.")}</p>
      {setup.error && <p id={`${pathInputId}-error`} className="field__help field__help--error" role="alert">{setup.error}</p>}
    </div>
      {setup.command && setup.commands ? <>
        <details className="agent-setup-disclosure agent-setup-disclosure--option" open={commandView === "one-line"} onToggle={toggleView("one-line")}><summary>
          <span className="status-tile status-tile--sm status-tile--accent" aria-hidden="true"><SquareTerminal /></span>
          <span className="agent-setup-disclosure__text">
            <span className="agent-setup-disclosure__title-row"><span className="agent-setup-disclosure__title">{t("One-Line Setup Command")}</span><span className="agent-setup-disclosure__badge">{t("Recommended")}</span></span>
            <span className="agent-setup-disclosure__hint">{t("Paste once to set permissions, add the cron job and run the first check.")}</span>
          </span></summary>
          <section className="code-surface agent-setup-command"><div className="code-surface__header"><strong>{t("Run As Root")}</strong><CopyButton value={setup.command} label={t("Copy Setup Command")} /></div><pre tabIndex={0} aria-label={t("One-Line Setup Command")}><code>{setup.command}</code></pre>
          </section>
        </details>
        <details className="agent-setup-disclosure agent-setup-disclosure--option" open={commandView === "separate"} onToggle={toggleView("separate")}><summary>
          <span className="status-tile status-tile--sm status-tile--accent" aria-hidden="true"><ListOrdered /></span>
          <span className="agent-setup-disclosure__text">
            <span className="agent-setup-disclosure__title-row"><span className="agent-setup-disclosure__title">{t("Use Separate Commands")}</span></span>
            <span className="agent-setup-disclosure__hint">{t("Run each step yourself: permissions, cron job, then the first run.")}</span>
          </span></summary>
          <div className="agent-setup-separate">{[
            { title: t("1. Set File Permissions"), label: t("Copy Permissions Command"), value: setup.commands.permissions },
            { title: t("2. Register The Cron Job"), label: t("Copy Cron Command"), value: setup.commands.cron },
            { title: t("3. Run And Report To Central Server"), label: t("Copy Run Command"), value: setup.commands.run }
          ].map(command => <section key={command.label} className="code-surface"><div className="code-surface__header"><strong>{command.title}</strong><CopyButton value={command.value} label={command.label} /></div><pre tabIndex={0} aria-label={command.title}><code>{command.value}</code></pre></section>)}</div>
        </details>
      </> : null}
    </div>}
    {step === 1 ? <>
      <section className="agent-setup-download" aria-label={t("Agent Script File")}>
        <div className="agent-setup-file"><span className="status-tile status-tile--accent" aria-hidden="true"><FileCode2 /></span>
          <div><strong>{setup.filename ?? installation.script_filename}</strong><p>{t("Upload To")}{" "}<code>{scriptPath}</code></p></div></div>
        <div className="action-row"><button className="button button--primary" type="button" onClick={download}><Download aria-hidden="true" />{t("Download Script")}</button><CopyButton value={installation.script} label={t("Copy Script")} /></div>
      </section>      <details key="script-preview" className="agent-setup-disclosure"><summary>{t("View Script")}</summary>
        <div className="code-surface"><pre tabIndex={0} aria-label={compact ? t("Replacement Agent Script") : t("Generated Agent Script")}><code>{installation.script}</code></pre></div>
      </details>
    </> : null}
    {step === 1 && setup.error ? <p className="field__help field__help--error" role="alert">{setup.error}</p> : null}
    <div className="agent-setup-footer">{step === 1 ? <><p>{t("Keep this window open until the script is saved.")}</p><button className="button button--secondary" type="button" disabled={Boolean(initialSetupError)} onClick={() => setStep(2)}>{t("Next: Run Setup")}<ArrowRight aria-hidden="true" /></button></> : <><button className="button button--secondary" type="button" onClick={() => setStep(1)}><ArrowLeft aria-hidden="true" />{t("Back To Download")}</button>
      {onDone ? <HoldConfirmButton tone="primary" lockSeconds={0} icon={<Check aria-hidden="true" />} label={t("Done Setup")}
        description={t("Press and hold for {0} seconds to close.", HOLD_CONFIRM_SECONDS)} onConfirm={onDone} /> : null}</>}</div>
  </div>;
}
