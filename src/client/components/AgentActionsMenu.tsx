import { MoreHorizontal } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

/** Native light-dismiss action disclosure; no write is performed by opening this control. */
export function AgentActionsMenu({ name, children }: { name: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button ref={trigger} className="icon-button" type="button" data-agent-actions
      aria-label={`More Actions For ${name}`} aria-expanded={open} aria-controls={id}
      onClick={() => {
        if (!panel.current || !trigger.current) return;
        if (panel.current.matches(":popover-open")) { panel.current.hidePopover(); return; }
        panel.current.showPopover();
        const anchor = trigger.current.getBoundingClientRect();
        const popup = panel.current.getBoundingClientRect();
        panel.current.style.left = `${Math.max(8, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 8))}px`;
        panel.current.style.top = `${anchor.bottom + popup.height + 8 > window.innerHeight ? Math.max(8, anchor.top - popup.height - 8) : anchor.bottom + 8}px`;
        panel.current.querySelector<HTMLElement>("a[href], button:not([hidden])")?.focus();
      }}><MoreHorizontal aria-hidden="true" /></button>
    <div ref={panel} id={id} popover="auto" className="agent-actions-popover" role="group"
      aria-label={`Actions For ${name}`}
      onToggle={() => setOpen(panel.current?.matches(":popover-open") ?? false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { panel.current?.hidePopover(); trigger.current?.focus(); }
      }}
      onClick={(event) => { if ((event.target as HTMLElement).closest("a, button")) panel.current?.hidePopover(); }}>
      {children}
    </div>
  </>;
}
