import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Inbox, LayoutDashboard, LogOut, RefreshCw, RotateCcw, Search, CloudOff, Sun, Moon, Monitor } from "lucide-react";
import { openGuide } from "@/components/Guide";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Logo, StatusPad, STATUS_LABEL, Initials, MonoLabel, MetaChip } from "@/components/bits";
import { useSession, loadProject, selectSet, signOut } from "@/state/session";
import { openItem, pendingLocal } from "@/state/editor";
import { confirm } from "@/state/dialogs";
import { itemStatus } from "@/lib/project.js";
import { fmtAgo, fmtHours, fmtMB } from "@/lib/util.js";
import { resetDemo } from "@/lib/demo.js";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { DataSet, Item } from "@/editor/types";

type F = "all" | "todo" | "in_progress" | "returned" | "done" | "reviewed" | "mine" | "review";

export function Home() {
  const { project, setId, listing, listError, store } = useSession();
  const set = project?.sets.find((s) => s.id === setId) || project?.sets[0];
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">AIMScribe</p>
            <MonoLabel className="text-[10px]">{store?.kind === "demo" ? "Demo" : "Annotator"}</MonoLabel>
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => openGuide()} className="rounded-full"><BookOpen /> Guide</Button>
          <UserMenu onRefresh={() => loadProject()} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {listing && !project ? (
          <ListSkeleton text={listing} />
        ) : listError ? (
          <div className="mt-10 rounded-3xl border bg-card p-6">
            <p className="font-medium text-destructive">Could not load your files</p>
            <p className="mt-1 text-sm text-muted-foreground">{listError}</p>
            <Button variant="outline" className="mt-4" onClick={() => loadProject()}><RefreshCw /> Try again</Button>
          </div>
        ) : set ? (
          <SetView set={set} />
        ) : project ? (
          <div className="mx-auto mt-20 max-w-md rounded-[28px] border bg-card p-8 text-center shadow-soft">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary"><Inbox className="size-5" /></div>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">No files assigned yet</h1>
            <p className="mt-2 text-[15px] text-muted-foreground">When the project lead assigns you recordings, they appear here.</p>
            <Button variant="outline" className="mt-6" onClick={() => loadProject()}><RefreshCw /> Check again</Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export function UserMenu({ onRefresh, extra }: { onRefresh?: () => void; extra?: React.ReactNode }) {
  const { user, store, me } = useSession();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-none ring-ring/40 focus-visible:ring-4" aria-label="Account">
          <Initials name={user.name} className="size-9 text-xs" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-2xl p-1.5">
        <DropdownMenuLabel className="font-normal">
          <p className="font-medium">{user.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{user.email}</p>
          {me && <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{me.role}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {extra}
        <DropdownMenuItem onClick={() => openGuide()}><BookOpen /> Annotation guide</DropdownMenuItem>
        {me?.isAdmin && useSession.getState().screen !== "admin" && (
          <DropdownMenuItem onClick={() => useSession.setState({ screen: "admin", returnTo: "admin" })}><LayoutDashboard /> Admin dashboard</DropdownMenuItem>
        )}
        {store?.kind === "demo" && (
          <DropdownMenuItem onClick={async () => { if (await confirm("Reset the demo?", "Deletes the demo annotations saved in this browser.", "Reset", "Cancel", true)) { resetDemo(); loadProject(); } }}>
            <RotateCcw /> Reset demo data
          </DropdownMenuItem>
        )}
        <DropdownMenuLabel className="pt-2 font-mono text-[11px] font-normal uppercase tracking-wider text-muted-foreground">Theme</DropdownMenuLabel>
        <div className="mx-1 mb-1 grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1">
          {([["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "Device", Monitor]] as const).map(([t, label, Icon]) => (
            <button key={t} onClick={() => { setTheme(t); setThemeState(t); }}
              className={cn("flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] transition", theme === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <DropdownMenuSeparator />
        {onRefresh && <DropdownMenuItem onClick={onRefresh}><RefreshCw /> Refresh</DropdownMenuItem>}
        <DropdownMenuItem onClick={signOut}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SetView({ set }: { set: DataSet }) {
  const { project, user, listing, store } = useSession();
  const demo = store?.kind === "demo";
  const [filter, setFilter] = useState<F>("all");
  const [q, setQ] = useState("");
  const me = user!.email;

  const stats = useMemo(() => {
    const by: Record<string, number> = { todo: 0, in_progress: 0, returned: 0, done: 0, reviewed: 0 };
    let speech = 0, size = 0;
    for (const it of set.items) {
      const st = itemStatus(it);
      by[st]++;
      size += it.audio.size;
      if (st === "done" || st === "reviewed") speech += Math.max(0, ...it.outputs.filter((o) => o.status === st).map((o) => o.speech));
    }
    const mine = set.items.filter((it) => it.outputs.some((o) => o.annotator === me)).length;
    const review = set.items.filter(needsMyReview).length;
    return { by, speech, size, mine, review };
  }, [set, me]);

  const items = set.items.filter((it) => {
    if (q && !it.base.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "mine") return it.outputs.some((o) => o.annotator === me);
    if (filter === "review") return needsMyReview(it);
    return filter === "all" || itemStatus(it) === filter;
  });
  const pending = pendingLocal();
  const total = set.items.length || 1;
  const filters: [F, string, number][] = [
    ["all", "All", set.items.length], ["todo", "To do", stats.by.todo], ["in_progress", "In progress", stats.by.in_progress],
    ["returned", "Returned", stats.by.returned], ["done", "Done", stats.by.done], ["reviewed", "Reviewed", stats.by.reviewed],
    ...(demo ? [["mine", "Mine", stats.mine] as [F, string, number]] : []), ...(stats.review ? [["review", "To review", stats.review] as [F, string, number]] : []),
  ];

  return (
    <>
      <section className="pt-8 sm:pt-10">
        <MonoLabel>{demo ? "Dataset" : "My tasks"}</MonoLabel>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-3">
          {project!.sets.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="-ml-2 flex items-center gap-1.5 rounded-xl px-2 py-1 text-[28px] font-semibold tracking-tight outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/30">
                  {set.name.split("/").pop()} <ChevronDown className="size-5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64 rounded-2xl p-1.5">
                <DropdownMenuRadioGroup value={set.id} onValueChange={selectSet}>
                  {project!.sets.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id} className="rounded-lg py-2">
                      <span className="flex-1">{s.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{s.items.length}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <h1 className="text-[28px] font-semibold tracking-tight">{set.name.split("/").pop()}</h1>
          )}
          {listing && <RefreshCw className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <MetaChip>{set.items.length} files</MetaChip>
          <MetaChip>{fmtMB(stats.size)}</MetaChip>
          <MetaChip>{fmtHours(stats.speech)} speech done</MetaChip>
        </div>

        {/* progress strip */}
        <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-secondary">
          {(["reviewed", "done", "returned", "in_progress"] as const).map((k) => stats.by[k] ? (
            <div key={k} style={{ width: `${(stats.by[k] / total) * 100}%` }}
              className={cn("h-full", k === "reviewed" && "bg-ink", k === "done" && "bg-primary", k === "returned" && "bg-destructive/70", k === "in_progress" && "bg-primary/35")} />
          ) : null)}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {(["reviewed", "done", "returned", "in_progress", "todo"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <i className={cn("size-2 rounded-full", k === "reviewed" && "bg-ink", k === "done" && "bg-primary", k === "returned" && "bg-destructive/70", k === "in_progress" && "bg-primary/35", k === "todo" && "bg-secondary ring-1 ring-border")} />
              {STATUS_LABEL[k]} {stats.by[k]}
            </span>
          ))}
        </div>
      </section>

      {pending.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <CloudOff className="size-4 text-warning" />
          <span className="font-medium">Saved only on this device:</span>
          {pending.map((p) => {
            const it = project!.sets.flatMap((s) => s.items).find((i) => i.setId === p.setId && i.base === p.base);
            return (
              <Button key={p.base + p.setId} size="xs" variant="outline" onClick={() => (it ? openItem(it) : toast("That file is not in these folders"))}>
                {p.base} · {fmtAgo(p.at)}
              </Button>
            );
          })}
          <span className="text-muted-foreground">Open to upload.</span>
        </div>
      )}

      <section className="mt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <ToggleGroup type="single" spacing={1.5} value={filter} onValueChange={(v) => v && setFilter(v as F)}
            className="no-scrollbar -mx-4 flex w-auto justify-start gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {filters.filter(([k, , n]) => n > 0 || k === "all" || k === "todo").map(([k, label, n]) => (
              <ToggleGroupItem key={k} value={k}
                className="h-9 shrink-0 rounded-full border bg-card px-3.5 text-[13px] data-[state=on]:border-ink data-[state=on]:bg-ink data-[state=on]:text-ink-foreground">
                {label} <span className="font-mono text-[11px] opacity-60">{n}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative sm:ml-auto sm:w-56">
            <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a file" className="h-10 rounded-full pl-10" />
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border bg-card shadow-soft">
          {items.length ? items.map((it, i) => <FileRow key={it.key} item={it} first={i === 0} />) : (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nothing here with this filter.</p>
          )}
        </div>
      </section>

      {demo && <TeamCard />}
    </>
  );
}

/** A reviewer's file with a finished annotation waiting for them. */
const needsMyReview = (it: Item) => !!it.access?.review && !it.access?.annotate && it.outputs.some((o) => o.status === "done");

function FileRow({ item, first }: { item: Item; first: boolean }) {
  const me = useSession((s) => s.user!.email);
  const st = itemStatus(item);
  const lead = item.outputs.find((o) => o.status === st) || item.outputs[0];
  return (
    <button onClick={() => openItem(item)}
      className={cn("group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none sm:px-5", !first && "border-t")}>
      <StatusPad status={st} progress={lead && lead.total ? lead.checked / lead.total : 0} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold tracking-tight">{item.base}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {fmtMB(item.audio.size)} · {item.sources[0]?.label || "no draft"}
        </p>
      </div>
      <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
        {item.outputs.map((o) => (
          <span key={o.fileId} className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-2.5 pl-0.5 text-xs" title={`${o.annotator} · ${fmtAgo(o.updated)}`}>
            <Initials name={o.annotatorName} className="size-6" />
            <span>{o.annotator === me ? "You" : o.annotatorName.replace(/\s*\(.*\)/, "")}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {o.status === "in_progress" && o.total ? `${o.checked}/${o.total}` : STATUS_LABEL[o.status]}
            </span>
          </span>
        ))}
      </div>
      <div className="flex -space-x-1.5 sm:hidden">
        {item.outputs.map((o) => <Initials key={o.fileId} name={o.annotatorName} className="ring-2 ring-card" />)}
      </div>
      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function TeamCard() {
  const { project, user } = useSession();
  const rows = useMemo(() => {
    const m = new Map<string, { name: string; files: number; done: number; speech: number; spent: number; spentDone: number }>();
    for (const set of project!.sets) for (const it of set.items) for (const o of it.outputs) {
      const r = m.get(o.annotator) || { name: o.annotatorName, files: 0, done: 0, speech: 0, spent: 0, spentDone: 0 };
      r.files++;
      r.spent += o.spent;
      if (o.status === "done" || o.status === "reviewed") { r.done++; r.speech += o.speech; r.spentDone += o.spent; }
      m.set(o.annotator, r);
    }
    return [...m.entries()];
  }, [project]);
  if (!rows.length) return null;
  return (
    <section className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <MonoLabel>Team</MonoLabel>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Progress by annotator</h2>
        </div>
        <p className="max-w-56 text-right font-mono text-[11px] leading-snug text-muted-foreground">hours per speech hour = r in the schedule formula</p>
      </div>
      <div className="mt-4 overflow-x-auto rounded-3xl border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {["Annotator", "Files", "Done", "Speech done", "Worked", "Hours / speech h"].map((h, i) => (
                <TableHead key={h} className={cn("h-11 font-mono text-[11px] font-medium uppercase tracking-wider", i ? "text-right" : "pl-5")}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([email, r]) => (
              <TableRow key={email}>
                <TableCell className="pl-5"><span className="flex items-center gap-2"><Initials name={r.name} />{email === user!.email ? "You" : r.name}</span></TableCell>
                <TableCell className="text-right font-mono tabular">{r.files}</TableCell>
                <TableCell className="text-right font-mono tabular">{r.done}</TableCell>
                <TableCell className="text-right font-mono tabular">{fmtHours(r.speech)}</TableCell>
                <TableCell className="text-right font-mono tabular">{fmtHours(r.spent)}</TableCell>
                <TableCell className="pr-5 text-right font-mono tabular">{r.speech > 60 ? (r.spentDone / r.speech).toFixed(1) : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function ListSkeleton({ text }: { text: string }) {
  return (
    <div className="pt-10">
      <div className="h-3 w-20 animate-pulse rounded bg-secondary" />
      <div className="mt-3 h-8 w-48 animate-pulse rounded-lg bg-secondary" />
      <p className="mt-6 font-mono text-xs text-muted-foreground">{text}</p>
      <div className="mt-4 overflow-hidden rounded-3xl border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("flex items-center gap-4 px-5 py-4", i && "border-t")}>
            <div className="size-10 animate-pulse rounded-xl bg-secondary" />
            <div className="flex-1 space-y-2"><div className="h-3.5 w-16 animate-pulse rounded bg-secondary" /><div className="h-3 w-40 animate-pulse rounded bg-secondary" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
