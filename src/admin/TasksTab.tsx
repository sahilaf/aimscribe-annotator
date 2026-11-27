import { useEffect, useMemo, useState } from "react";
import { Eye, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Initials, MonoLabel, StatusPad } from "@/components/bits";
import { api, useSession, selectSet } from "@/state/session";
import { openItem } from "@/state/editor";
import { confirm, prompt } from "@/state/dialogs";
import { fmtTime } from "@/lib/util.js";
import { cn } from "@/lib/utils";
import type { Overview } from "@/lib/api";
import { audioSec, itemState, STATE_LABEL, type ItemState } from "./stats";

type F = "all" | ItemState | "needs_review";

export function TasksTab({ ov, refresh }: { ov: Overview; refresh: () => void }) {
  const setId = useSession((s) => s.setId);
  const set = ov.project.sets.find((s) => s.id === setId) || ov.project.sets[0];
  const [filter, setFilter] = useState<F>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState<"annotate" | "review">("annotate");
  const [n, setN] = useState(10);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(new Set()), [setId]);

  const people = ov.users.filter((u) => u.status !== "blocked");
  const nameOf = (email: string) => ov.users.find((u) => u.email === email)?.name || email;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: set?.items.length || 0, needs_review: 0 };
    for (const it of set?.items || []) {
      const s = itemState(it);
      c[s] = (c[s] || 0) + 1;
      if (s === "done" && !it.assigned?.some((a) => a.kind === "review")) c.needs_review++;
    }
    return c;
  }, [set]);

  if (!set) return <p className="text-muted-foreground">No sets yet. Add folders in Settings.</p>;

  const items = set.items.filter((it) => {
    if (q && !it.base.toLowerCase().includes(q.toLowerCase())) return false;
    const s = itemState(it);
    if (filter === "needs_review") return s === "done" && !it.assigned?.some((a) => a.kind === "review");
    return filter === "all" || s === filter;
  });
  const allOn = items.length > 0 && items.every((it) => sel.has(it.key));
  const toggle = (k: string) => setSel((old) => { const s = new Set(old); if (s.has(k)) s.delete(k); else s.add(k); return s; });

  const run = async (action: "add" | "remove") => {
    let email = person;
    if (action === "add" && !email) return toast("Choose a person first");
    if (action === "remove" && !email) {
      if (!(await confirm("Unassign everyone?", `Remove every ${kind === "annotate" ? "annotator" : "reviewer"} from ${sel.size} file${sel.size > 1 ? "s" : ""}? Saved work stays in Drive.`, "Unassign", "Cancel", true))) return;
      email = "*";
    }
    setBusy(true);
    try {
      await api!.assign({ keys: [...sel], email, kind, action });
      toast.success(action === "add" ? `Assigned ${sel.size} file${sel.size > 1 ? "s" : ""} to ${nameOf(email)}` : "Unassigned",
        action === "add" ? { description: kind === "review" ? "They can now review these files." : "They see them next time they open the app." } : undefined);
      setSel(new Set());
      refresh();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  const pickPerson = async (v: string) => {
    if (v !== "__new__") return setPerson(v);
    const email = await prompt("Add a person", "Their Google email. They can sign in and start once you assign files.", "", { ok: "Add" });
    if (email && /\S+@\S+\.\S+/.test(email)) setPerson(email.trim().toLowerCase());
  };

  const filters: [F, string][] = [["all", "All"], ["unassigned", "Unassigned"], ["assigned", "Not started"], ["in_progress", "In progress"], ["returned", "Returned"], ["done", "Done"], ["needs_review", "Needs reviewer"], ["reviewed", "Reviewed"]];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <MonoLabel>Assign work</MonoLabel>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Tasks</h1>
        </div>
        {ov.project.sets.length > 1 && (
          <Select value={set.id} onValueChange={selectSet}>
            <SelectTrigger className="h-10 min-w-48 rounded-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl">
              {ov.project.sets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name.split("/").pop()} · {s.items.length}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <ToggleGroup type="single" spacing={1.5} value={filter} onValueChange={(v) => v && setFilter(v as F)} className="no-scrollbar -mx-4 w-auto justify-start overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {filters.filter(([k]) => k === "all" || counts[k]).map(([k, label]) => (
            <ToggleGroupItem key={k} value={k} className="h-9 shrink-0 rounded-full border bg-card px-3.5 text-[13px] data-[state=on]:border-ink data-[state=on]:bg-ink data-[state=on]:text-ink-foreground">
              {label} <span className="font-mono text-[11px] opacity-60">{counts[k] || 0}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative lg:ml-auto lg:w-52">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a file" className="h-10 rounded-full pl-10" />
        </div>
      </div>

      {/* action bar: who, as what, then assign */}
      <div className={cn("sticky top-[72px] z-10 flex flex-wrap items-center gap-2 rounded-3xl border bg-card/95 p-2.5 shadow-soft backdrop-blur md:top-20", sel.size && "ring-2 ring-primary/30")}>
        <span className="px-2 font-mono text-xs tabular">{sel.size ? `${sel.size} selected` : "Select files"}</span>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-9" onClick={() => {
            const pick = items.filter((it) => itemState(it) === "unassigned").slice(0, n).map((it) => it.key);
            setSel(new Set(pick));
            if (!pick.length) toast("No unassigned files in this view");
          }}>Next</Button>
          <Input type="number" min={1} max={500} value={n} onChange={(e) => setN(Math.max(1, +e.target.value || 1))} className="h-9 w-16 rounded-full text-center font-mono text-xs" aria-label="How many" />
          <span className="text-xs text-muted-foreground">unassigned</span>
        </div>
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <Select value={person} onValueChange={pickPerson}>
          <SelectTrigger className="h-9 w-48 rounded-full bg-card text-[13px]"><SelectValue placeholder="Choose a person" /></SelectTrigger>
          <SelectContent className="rounded-xl">
            {people.map((u) => (
              <SelectItem key={u.email} value={u.email}>
                <span className="flex items-center gap-2"><Initials name={u.name} className="size-5 text-[9px]" />{u.name}{u.status === "pending" && <span className="font-mono text-[10px] text-primary">new</span>}</span>
              </SelectItem>
            ))}
            {person && !people.some((u) => u.email === person) && <SelectItem value={person}>{person}</SelectItem>}
            <SelectSeparator />
            <SelectItem value="__new__"><span className="flex items-center gap-2"><UserPlus className="size-3.5" /> Add by email…</span></SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup type="single" spacing={0} value={kind} onValueChange={(v) => v && setKind(v as "annotate" | "review")} variant="outline" className="rounded-full">
          <ToggleGroupItem value="annotate" className="h-9 px-3 text-[13px] first:rounded-l-full data-[state=on]:bg-ink data-[state=on]:text-ink-foreground">Annotate</ToggleGroupItem>
          <ToggleGroupItem value="review" className="h-9 px-3 text-[13px] last:rounded-r-full data-[state=on]:bg-ink data-[state=on]:text-ink-foreground">Review</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-1 justify-end gap-1.5">
          {sel.size > 0 && <Button variant="ghost" size="sm" className="h-9" onClick={() => setSel(new Set())}><X /> Clear</Button>}
          <Button variant="outline" size="sm" className="h-9" disabled={!sel.size || busy} onClick={() => run("remove")}>Unassign</Button>
          <Button size="sm" className="h-9 px-4" disabled={!sel.size || busy} onClick={() => run("add")}>Assign</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border bg-card shadow-soft">
        <label className="flex cursor-pointer items-center gap-3 border-b bg-secondary/40 px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground sm:px-5">
          <input type="checkbox" className="size-4" style={{ accentColor: "var(--ink)" }} checked={allOn}
            onChange={() => setSel(allOn ? new Set() : new Set(items.map((it) => it.key)))} />
          <span className="flex-1">{items.length} file{items.length === 1 ? "" : "s"}</span>
          <span className="hidden w-72 sm:block">Assigned to</span>
          <span className="hidden w-24 md:block">Status</span>
          <span className="w-14" />
        </label>
        {items.map((it) => {
          const st = itemState(it);
          const lead = it.outputs.find((o) => o.status === st) || it.outputs[0];
          return (
            <label key={it.key} className={cn("flex cursor-pointer items-center gap-3 border-t px-4 py-3 first-of-type:border-t-0 hover:bg-accent/50 sm:px-5", sel.has(it.key) && "bg-primary/5")}>
              <input type="checkbox" className="size-4" style={{ accentColor: "var(--ink)" }} checked={sel.has(it.key)} onChange={() => toggle(it.key)} />
              <StatusPad status={st === "unassigned" || st === "assigned" ? "todo" : st} progress={lead?.total ? lead.checked / lead.total : 0} className="size-8 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold tracking-tight">{it.base}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{fmtTime(audioSec(it), 0)} · {it.sources[0]?.label || "no draft"}</p>
              </div>
              <div className="hidden w-72 flex-wrap gap-1 sm:flex">
                {(it.assigned || []).map((a) => (
                  <span key={a.email + a.kind} className="inline-flex h-6 items-center gap-1 rounded-full border bg-background pr-2 pl-0.5 text-[11px]" title={`${a.kind} · ${a.email}`}>
                    <Initials name={nameOf(a.email)} className="size-5 text-[9px]" />
                    <span className="max-w-24 truncate">{nameOf(a.email).replace(/\s*\(.*\)/, "")}</span>
                    {a.kind === "review" && <Eye className="size-3 text-muted-foreground" />}
                  </span>
                ))}
                {!it.assigned?.length && <span className="text-xs text-muted-foreground">–</span>}
              </div>
              <span className="hidden w-24 font-mono text-[11px] text-muted-foreground md:block">{STATE_LABEL[st]}</span>
              <Button variant="ghost" size="sm" className="w-14" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openItem(it); }}>Open</Button>
            </label>
          );
        })}
        {!items.length && <p className="px-6 py-10 text-center text-sm text-muted-foreground">No files with this filter.</p>}
      </div>
    </div>
  );
}
