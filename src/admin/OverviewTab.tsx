import { ArrowRight, Clock3, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Initials, MonoLabel } from "@/components/bits";
import { openItem } from "@/state/editor";
import { fmtAgo, fmtHours } from "@/lib/util.js";
import { cn } from "@/lib/utils";
import type { Overview } from "@/lib/api";
import type { computeStats } from "./stats";
import type { Tab } from "@/screens/Dashboard";

type Stats = ReturnType<typeof computeStats>;

export const SEG = [
  ["reviewed", "bg-ink", "Reviewed"], ["done", "bg-primary", "Done"], ["returned", "bg-destructive/70", "Returned"],
  ["in_progress", "bg-primary/40", "In progress"], ["assigned", "bg-ink/15", "Assigned"], ["unassigned", "bg-secondary", "Unassigned"],
] as const;

function Tile({ label, value, sub, children, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-3xl border bg-card p-5 shadow-soft", className)}>
      <MonoLabel className="text-[10px]">{label}</MonoLabel>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular">{value}</p>
      {sub && <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{sub}</p>}
      {children}
    </div>
  );
}

export function OverviewTab({ ov, stats, goto }: { ov: Overview; stats: Stats; goto: (t: Tab) => void }) {
  const t = stats.totals;
  const pct = t.files ? Math.round((t.finished / t.files) * 100) : 0;
  if (!ov.folders.length) {
    return (
      <div className="mx-auto max-w-lg rounded-[28px] border bg-card p-8 text-center shadow-soft">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary"><Inbox className="size-5" /></div>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">Add your set folders</h2>
        <p className="mt-2 text-muted-foreground">Point the app at test_set, dev_set and train_set in your Drive.</p>
        <Button variant="ink" className="mt-6" onClick={() => goto("settings")}>Open settings <ArrowRight /></Button>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <div>
        <MonoLabel>Project</MonoLabel>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Overview</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Files finished" value={<>{t.finished}<span className="text-lg text-muted-foreground"> / {t.files}</span></>} sub={`${t.reviewed} reviewed · ${t.inProgress} in progress`}>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
        </Tile>
        <Tile label="Audio left" value={fmtHours(t.audioLeft)} sub={`of ${fmtHours(t.audio)} in ${ov.project.sets.length} set${ov.project.sets.length === 1 ? "" : "s"}`} />
        <Tile label="Work left" value={stats.workLeft != null ? `≈ ${fmtHours(stats.workLeft)}` : "–"}
          sub={stats.r ? `at ${stats.r.toFixed(1)} working hours per speech hour` : "shown once the team has finished some files"} />
        <Tile label="Unassigned" value={t.unassigned} sub={`${stats.active} people working`}>
          {t.unassigned > 0 && <Button variant="link" className="mt-1 h-auto px-0 text-[13px]" onClick={() => goto("tasks")}>Assign files <ArrowRight /></Button>}
        </Tile>
      </div>

      <section className="rounded-3xl border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><MonoLabel className="text-[10px]">Sets</MonoLabel><h2 className="mt-1 text-lg font-semibold tracking-tight">Progress by set</h2></div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {SEG.map(([, cls, label]) => (
              <span key={label} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"><i className={cn("size-2 rounded-full ring-1 ring-border", cls)} />{label}</span>
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-5">
          {stats.sets.map((s) => (
            <div key={s.set.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{s.set.name.split("/").pop()}</p>
                <p className="font-mono text-xs text-muted-foreground tabular">
                  {s.counts.done + s.counts.reviewed}/{s.files} finished · {fmtHours(s.audioLeft)} audio left
                </p>
              </div>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-secondary">
                {SEG.map(([k, cls]) => s.counts[k] ? <div key={k} className={cls} style={{ width: `${(s.counts[k] / s.files) * 100}%` }} title={`${k}: ${s.counts[k]}`} /> : null)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="min-w-0 rounded-3xl border bg-card shadow-soft">
          <div className="flex items-end justify-between gap-3 p-5 pb-3 sm:p-6 sm:pb-3">
            <div><MonoLabel className="text-[10px]">Team</MonoLabel><h2 className="mt-1 text-lg font-semibold tracking-tight">Who is doing what</h2></div>
            <Button variant="ghost" size="sm" onClick={() => goto("people")}>People <ArrowRight /></Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {["Person", "Assigned", "Working", "Finished", "Speech", "Worked", "h / speech h", "Last active"].map((h, i) => (
                    <TableHead key={h} className={cn("h-10 font-mono text-[10px] font-medium uppercase tracking-wider", i ? "text-right" : "pl-6")}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.people.filter((p) => p.annotating || p.reviewing || p.done || p.inProgress).map((p) => (
                  <TableRow key={p.email}>
                    <TableCell className="pl-6"><span className="flex items-center gap-2.5"><Initials name={p.name} /><span className="max-w-40 truncate">{p.name}</span></span></TableCell>
                    <TableCell className="text-right font-mono tabular">{p.annotating}{p.reviewing ? <span className="text-muted-foreground"> +{p.reviewing}r</span> : ""}</TableCell>
                    <TableCell className="text-right font-mono tabular">{p.inProgress}</TableCell>
                    <TableCell className="text-right font-mono tabular">{p.done + p.reviewed}</TableCell>
                    <TableCell className="text-right font-mono tabular">{fmtHours(p.speech)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{fmtHours(p.spent)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{p.speech > 300 ? (p.spentDone / p.speech).toFixed(1) : "–"}</TableCell>
                    <TableCell className="pr-6 text-right font-mono text-xs text-muted-foreground">{p.lastActive ? fmtAgo(p.lastActive) : "–"}</TableCell>
                  </TableRow>
                ))}
                {!stats.people.some((p) => p.annotating || p.reviewing || p.done || p.inProgress) && (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nobody has files yet. Assign some in Tasks.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <div className="grid content-start gap-6">
          <section className="rounded-3xl border bg-card p-5 shadow-soft">
            <MonoLabel className="text-[10px]">Review queue</MonoLabel>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{stats.reviewQueue.length ? `${stats.reviewQueue.length} waiting` : "Nothing waiting"}</h2>
            <div className="mt-3 grid gap-1">
              {stats.reviewQueue.slice(0, 6).map(({ item, o }) => (
                <button key={o.fileId} onClick={() => openItem(item)} className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-accent">
                  <Initials name={o.annotatorName} />
                  <div className="min-w-0 flex-1"><p className="font-medium">{item.base}</p><p className="truncate font-mono text-[11px] text-muted-foreground">{o.annotatorName} · {fmtAgo(o.updated)}</p></div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-3xl border bg-card p-5 shadow-soft">
            <MonoLabel className="text-[10px]">Activity</MonoLabel>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent saves</h2>
            <div className="mt-3 grid gap-3">
              {stats.recent.map(({ item, o }) => (
                <div key={o.fileId} className="flex items-start gap-3 text-sm">
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 leading-snug"><span className="font-medium">{o.annotatorName}</span> · {item.base} ·{" "}
                    <span className="text-muted-foreground">{o.status === "in_progress" ? `${o.checked}/${o.total} checked` : o.status}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{fmtAgo(o.updated)}</span></p>
                </div>
              ))}
              {!stats.recent.length && <p className="text-sm text-muted-foreground">No annotations saved yet.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
