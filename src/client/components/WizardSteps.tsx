import { Check } from "lucide-react";
import type { CSSProperties } from "react";

export interface WizardStep { title: string; hint: string }

/** Numbered progress for a multi-step modal; finished steps show a check. Shares the Agent Registered step styling. */
export function WizardSteps({ steps, current, label }: { steps: readonly WizardStep[]; current: number; label: string }) {
  return <ol className="agent-setup-steps wizard-steps" aria-label={label} style={{ "--wizard-steps": steps.length } as CSSProperties}>
    {steps.map((step, index) => <li key={step.title} aria-current={index === current ? "step" : undefined}
      data-state={index < current ? "done" : index === current ? "current" : "upcoming"}>
      <span className="agent-setup-steps__marker" aria-hidden="true">{index < current ? <Check /> : index + 1}</span>
      <span className="agent-setup-steps__text"><strong>{step.title}</strong><small>{step.hint}</small></span>
    </li>)}
  </ol>;
}
