/* Hallmark · Cobalt operational UI · roomy two-step setup · existing tokens and one-time-secret lifecycle */
import { ArrowLeft, ArrowRight, Check, Download, FileCode2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { AgentInstallationResponse } from "../../shared/contracts";
import { buildAgentSetup } from "../lib/agent-setup";
import { CopyButton } from "./CopyButton";

/** Keeps download filename, cron path and one-line setup command synchronized without changing the embedded credential. */
export function AgentScriptSetup({ installation, compact = false }: { installation: AgentInstallationResponse; compact?: boolean }) {
  const defaultScriptPath = `/root/${installation.script_filename}`;
  const [scriptPath, setScriptPath] = useState(defaultScriptPath);
  const pathInputId = useId();
  const setup = buildAgentSetup(installation.crontab_entry, scriptPath);
  const initialSetupError = buildAgentSetup(installation.crontab_entry, defaultScriptPath).error;
  const [step, setStep] = useState<1 | 2>(1);
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
    { number: 1, title: "Download Script", hint: "Save the one-time file" },
    { number: 2, title: "Run Setup", hint: "Install and schedule it" }
  ] as const;
  return <div className="agent-script-setup">
    <ol className="agent-setup-steps" aria-label="Agent Setup Progress">
      {steps.map(item => <li key={item.number} aria-current={step === item.number ? "step" : undefined} data-state={step > item.number ? "done" : step === item.number ? "current" : "upcoming"}>
        <span className="agent-setup-steps__marker" aria-hidden="true">{step > item.number ? <Check /> : item.number}</span>
        <span className="agent-setup-steps__text"><strong>{item.title}</strong><small>{item.hint}</small></span>
      </li>)}
    </ol>
    <div className="agent-setup-heading"><h3 ref={heading} tabIndex={-1}>{step === 1 ? "Download The Agent Script" : "Run The Setup Command"}</h3>
      {step === 1 ? <p>Save this one-time script, then upload it to the path below on your server.</p>
        : <p>Run it once as root. It locks down the file, schedules it{scheduleLabel ? ` ${scheduleLabel}` : ""}, and sends the first report.</p>}</div>
    {step === 2 && <div className="field">
      <label htmlFor={pathInputId}>Script Path</label>
      <input id={pathInputId} name="script_path" type="text" value={scriptPath} placeholder="/root/myfile.sh" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={1024}
        aria-invalid={Boolean(setup.error)} aria-describedby={setup.error ? `${pathInputId}-error ${pathInputId}-help` : `${pathInputId}-help`} onChange={event => setScriptPath(event.target.value)} />
      <p id={`${pathInputId}-help`} className="field__help">Where you uploaded the script. The commands below update as you type.</p>
      {setup.error && <p id={`${pathInputId}-error`} className="field__help field__help--error" role="alert">{setup.error}</p>}
    </div>}
    {step === 1 ? <>
      <section className="agent-setup-download" aria-label="Agent Script File">
        <div className="agent-setup-file"><span className="status-tile status-tile--accent" aria-hidden="true"><FileCode2 /></span>
          <div><strong>{setup.filename ?? installation.script_filename}</strong><p>Upload To <code>{scriptPath}</code></p></div></div>
        <div className="action-row"><button className="button button--primary" type="button" onClick={download}><Download aria-hidden="true" />Download Script</button><CopyButton value={installation.script} label="Copy Script" /></div>
      </section>
      <details key="script-preview" className="agent-setup-disclosure"><summary>View Script</summary>
        <div className="code-surface"><pre tabIndex={0} aria-label={compact ? "Replacement Agent Script" : "Generated Agent Script"}><code>{installation.script}</code></pre></div>
      </details>
    </> : setup.command && setup.commands ? <>
      <section className="code-surface agent-setup-command"><div className="code-surface__header"><strong>One-Line Setup Command</strong><CopyButton value={setup.command} label="Copy Setup Command" /></div><pre tabIndex={0} aria-label="One-Line Setup Command"><code>{setup.command}</code></pre>
      </section>
      <details key="separate-commands" className="agent-setup-disclosure"><summary>Use Separate Commands</summary>
        <div className="agent-setup-separate">{[
          { title: "1. Set File Permissions", label: "Copy Permissions Command", value: setup.commands.permissions },
          { title: "2. Register The Cron Job", label: "Copy Cron Command", value: setup.commands.cron },
          { title: "3. Run And Report To Central Server", label: "Copy Run Command", value: setup.commands.run }
        ].map(command => <section key={command.label} className="code-surface"><div className="code-surface__header"><strong>{command.title}</strong><CopyButton value={command.value} label={command.label} /></div><pre tabIndex={0} aria-label={command.title}><code>{command.value}</code></pre></section>)}</div>
      </details>
    </> : null}
    {step === 1 && setup.error ? <p className="field__help field__help--error" role="alert">{setup.error}</p> : null}
    <div className="agent-setup-footer">{step === 1 ? <><p>Keep this window open until the script is saved.</p><button className="button button--secondary" type="button" disabled={Boolean(initialSetupError)} onClick={() => setStep(2)}>Next: Run Setup<ArrowRight aria-hidden="true" /></button></> : <><button className="button button--secondary" type="button" onClick={() => setStep(1)}><ArrowLeft aria-hidden="true" />Back To Download</button><p>Runs once now, then {scheduleLabel ?? "on the configured cron schedule"}.</p></>}</div>
  </div>;
}
