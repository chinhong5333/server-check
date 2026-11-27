import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { t } from "../i18n";

export interface WizardStep { title: string; hint: string }

/**
 * Numbered progress for a multi-step modal; finished steps show a check. Shares the Agent Registered step styling.
 * `bar` draws one short segment per step with the current step named underneath, for narrow single-column modals.
 */
export function WizardSteps({ steps, current, label, variant = "chevron" }: {
  steps: readonly WizardStep[]; current: number; label: string; variant?: "chevron" | "bar";
}) {
  if (variant === "bar") {
    const next = steps[current + 1];
    return <div className="wizard-progress">
      <ol className="wizard-progress__bars" aria-label={label} style={{ "--wizard-steps": steps.length } as CSSProperties}>
        {steps.map((step, index) => <li key={step.title} aria-current={index === current ? "step" : undefined}
          data-state={index < current ? "done" : index === current ? "current" : "upcoming"}>
          <span className="visually-hidden">{step.title}</span>
        </li>)}
      </ol>
      <p className="wizard-progress__caption" aria-hidden="true">
        <strong>{steps[current].title}</strong>
        <span>{t("Step {0} of {1}", current + 1, steps.length)}{next ? <span className="wizard-progress__next"> · {t("Next: {0}", next.title)}</span> : null}</span>
      </p>
    </div>;
  }
  return <ol className="agent-setup-steps wizard-steps" aria-label={label} style={{ "--wizard-steps": steps.length } as CSSProperties}>
    {steps.map((step, index) => <li key={step.title} aria-current={index === current ? "step" : undefined}
      data-state={index < current ? "done" : index === current ? "current" : "upcoming"}>
      <span className="agent-setup-steps__marker" aria-hidden="true">{index < current ? <Check /> : index + 1}</span>
      <span className="agent-setup-steps__text"><strong>{step.title}</strong><small>{step.hint}</small></span>
    </li>)}
  </ol>;
}
