import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-label="Loading Content">
      <div className="skeleton skeleton--title" />
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton skeleton--row" key={index} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <section className="feedback-state" role="status">
      <Inbox aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  );
}

export function ErrorState({
  title,
  message,
  onRetry
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section className="feedback-state feedback-state--error" role="alert">
      <AlertCircle aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Try Again
        </button>
      ) : null}
    </section>
  );
}

export function InlineLoader({ label }: { label: string }) {
  return (
    <span className="inline-loader" role="status">
      <LoaderCircle aria-hidden="true" />
      {label}
    </span>
  );
}
