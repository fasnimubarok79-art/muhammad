import type { ReactNode } from "react";

const JOB_TONE: Record<string, string> = {
  queued: "bg-muted", validating: "bg-muted", downloading: "bg-system", analyzing: "bg-system", transcribing: "bg-system",
  editing: "bg-system", rendering: "bg-system", completed: "bg-system", failed: "bg-danger", cancelled: "bg-faint",
};
const JOB_LABEL: Record<string, string> = {
  queued: "Queued", validating: "Validating", downloading: "Downloading", analyzing: "Analyzing", transcribing: "Transcribing",
  editing: "Building clips", rendering: "Rendering", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

export function StatusPill({ status, progress }: { status: string; progress?: number }) {
  const running = !["queued", "completed", "failed", "cancelled"].includes(status);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 px-2.5 py-0.5 text-[12px] font-medium tc">
      <span className={`h-1.5 w-1.5 rounded-full ${JOB_TONE[status] ?? "bg-muted"} ${running ? "animate-pulse" : ""}`} />
      {JOB_LABEL[status] ?? status}
      {running && progress !== undefined ? <span className="text-muted">{progress}%</span> : null}
    </span>
  );
}

const ACCESS: Record<string, { tone: string; label: string }> = {
  PROCESSABLE: { tone: "text-system border-system/40", label: "Processable" },
  PREVIEW_ONLY: { tone: "text-warn border-warn/40", label: "Preview only" },
  AUTHORIZATION_REQUIRED: { tone: "text-warn border-warn/40", label: "Authorization required" },
  UNSUPPORTED: { tone: "text-danger border-danger/40", label: "Unsupported" },
};

export function AccessBadge({ state }: { state: string }) {
  const a = ACCESS[state] ?? { tone: "text-muted border-line", label: state };
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${a.tone}`}>{a.label}</span>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted text-[13px]">
      <span className="h-3.5 w-3.5 rounded-full border-2 border-faint border-t-system animate-spin" />
      {label}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card border-dashed px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card border-danger/40 px-4 py-3 text-[13px]">
      <span className="text-danger font-semibold">Something went wrong.</span> <span className="text-muted">{message}</span>
      {onRetry && (
        <button className="ml-3 underline underline-offset-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Timeline-ruler motif: thin ticks with a tabular timecode. */
export function Ruler({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`h-2 w-full ${className}`} style={{ backgroundImage: "repeating-linear-gradient(90deg, #263046 0 1px, transparent 1px 12px), repeating-linear-gradient(90deg, #5B6478 0 1px, transparent 1px 60px)", backgroundSize: "auto 50%, auto 100%", backgroundRepeat: "repeat-x", backgroundPosition: "0 100%, 0 0" }} />
  );
}
