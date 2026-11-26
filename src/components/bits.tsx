// Small shared pieces: the logo, status pads (like sequencer pads), initials, mono labels.
import { Check, CheckCheck, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.74 0.17 52)" />
          <stop offset="1" stopColor="oklch(0.64 0.2 38)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 16v0M12.5 12v8M16 8.5v15M19.5 11.5v9M23 14.5v3" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  todo: "To do", in_progress: "In progress", returned: "Returned", done: "Done", reviewed: "Reviewed",
};

/** A rounded square that shows a file's state at a glance. */
export function StatusPad({ status, progress = 0, className }: { status: string; progress?: number; className?: string }) {
  const base = "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl";
  if (status === "reviewed") return <div className={cn(base, "bg-ink text-ink-foreground", className)}><CheckCheck className="size-4" /></div>;
  if (status === "done") return <div className={cn(base, "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]", className)}><Check className="size-4" strokeWidth={2.5} /></div>;
  if (status === "returned") return <div className={cn(base, "bg-destructive/10 text-destructive ring-2 ring-inset ring-destructive/70", className)}><Undo2 className="size-4" /></div>;
  if (status === "in_progress") {
    return (
      <div className={cn(base, "bg-primary/5 ring-2 ring-inset ring-primary/80", className)}>
        <div className="absolute inset-x-0 bottom-0 bg-primary/25 transition-all" style={{ height: `${Math.round(progress * 100)}%` }} />
      </div>
    );
  }
  return <div className={cn(base, "bg-secondary", className)} />;
}

const AV = ["#c9daf3", "#e2d0f0", "#d3e7cb", "#f3e0c1", "#f4cfcf", "#c8e8e4"];
export function Initials({ name, className }: { name: string; className?: string }) {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/[\s.@_-]+/).filter(Boolean);
  const ini = ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className={cn("inline-grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-neutral-800", className)} style={{ background: AV[h % AV.length] }}>
      {ini}
    </span>
  );
}

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground", className)}>{children}</p>;
}

export function MetaChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-3 font-mono text-xs text-muted-foreground tabular", className)}>
      {children}
    </span>
  );
}
