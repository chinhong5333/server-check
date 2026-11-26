import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../i18n";

/** Copies `value`. `iconOnly` drops the visible text for tight rows; the accessible name then carries the state. */
export function CopyButton({ value, label, iconOnly = false }: { value: string; label: string; iconOnly?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
  };

  const text = state === "copied" ? t("Copied") : state === "error" ? t("Copy Failed") : t("Copy");
  if (iconOnly) return (
    <button className="icon-button copy-button--icon" type="button" onClick={copy} aria-label={state === "idle" ? label : text} title={state === "idle" ? label : text}>
      {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
  return (
    <button className="button button--secondary copy-button" type="button" onClick={copy} aria-label={state === "idle" ? label : undefined}>
      {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {text}
    </button>
  );
}
