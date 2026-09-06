import { useEffect, useRef, type ReactNode } from "react";

interface ModalDialogProps {
  id: string;
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  dialogClassName?: string;
  surfaceClassName: string;
  restoreFocusTo: HTMLElement | null;
  children: ReactNode;
}

export function ModalDialog({
  id,
  open,
  labelledBy,
  describedBy,
  dialogClassName,
  surfaceClassName,
  restoreFocusTo,
  children
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      queueMicrotask(() => {
        dialog
          .querySelector<HTMLElement>("[data-dialog-initial-focus]")
          ?.focus();
      });
    }
    if (dialog && !open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    if (wasOpenRef.current && !open && restoreFocusTo?.isConnected) {
      restoreFocusTo.focus();
    }
    wasOpenRef.current = open;
  }, [open, restoreFocusTo]);

  return (
    <dialog
      ref={dialogRef}
      id={id}
      className={`agent-dialog${dialogClassName ? ` ${dialogClassName}` : ""}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
      }}
    >
      {open ? <div className={surfaceClassName}>{children}</div> : null}
    </dialog>
  );
}
