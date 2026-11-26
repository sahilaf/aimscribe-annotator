import { useEffect, useState } from "react";
import { ArrowLeftToLine, ArrowRightToLine, Combine, Minus, Plus, Play, Scissors, Trash2, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { MonoLabel, StatusPad, STATUS_LABEL } from "@/components/bits";
import {
  useEditor, activeSeg, nudge, boundaryHere, split, mergeNext, addAtPlayhead, removeActive, toggleOverlap, toggleChecked,
  setRole, setNotes, replay, undo, redo, mergeSpeaker,
} from "@/state/editor";
import { prompt } from "@/state/dialogs";
import { ROLES, BACKGROUND, UNSURE } from "@/lib/formats.js";
import { fmtTime } from "@/lib/util.js";
import { SegmentWaveCanvas, useLanes } from "./TimelineView";
import { SpeakerOptions } from "./TranscriptList";
import { speakerColor } from "./colors";
import { useDark } from "@/hooks/use-media";
import { cn } from "@/lib/utils";

const pref = (k: string, d: string) => localStorage.getItem("aimscribe:" + k) ?? d;

/** Insert at the cursor of the active text box; wraps the selection for paired tags. */
export function insertText(before: string, after = "") {
  const el = document.querySelector<HTMLTextAreaElement>("textarea.transcript-text");
  if (!el) return;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  const sel = el.value.slice(a, b);
  el.focus({ preventScroll: true });
  el.setRangeText(before + sel + after, a, b, "end");
  if (!sel && after) el.setSelectionRange(a + before.length, a + before.length);
  // tell React about the change
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  const v = el.value;
  setter.call(el, "");
  setter.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function insertDrug() {
  const el = document.querySelector<HTMLTextAreaElement>("textarea.transcript-text");
  const range = el ? [el.selectionStart, el.selectionEnd] as const : null;
  const name = await prompt("Drug tag", "Drug-list name in English, e.g. Napa Extra. Inside the tag, write what was said in Bangla.", pref("lastdrug", ""), { ok: "Insert" });
  if (name == null || !name.trim()) return;
  localStorage.setItem("aimscribe:lastdrug", name.trim());
  if (el && range) el.setSelectionRange(range[0], range[1]);
  insertText(`<ওষুধ=${name.trim()}>`, "</ওষুধ>");
}

const TAGS: [string, () => void][] = [
  ["[অস্পষ্ট]", () => insertText("[অস্পষ্ট]")], ["<নাম>", () => insertText("<নাম>", "</নাম>")], ["<ওষুধ=…>", insertDrug],
  ["-", () => insertText("-")], ["।", () => insertText("।")], ["?", () => insertText("?")],
];

function TimeField({ which }: { which: "start" | "end" }) {
  const t = useEditor((s) => activeSeg(s)?.[which] ?? 0);
  return (
    <div className="rounded-2xl border bg-card p-3">
      <MonoLabel className="text-[10px]">{which}</MonoLabel>
      <p className="mt-0.5 font-mono text-lg font-medium tabular">{fmtTime(t, 2)}</p>
      <div className="mt-2 flex gap-1">
        <Button variant="secondary" size="icon-sm" onClick={() => nudge(which, -0.1)} aria-label={`${which} 0.1 s earlier`}><Minus /></Button>
        <Button variant="secondary" size="icon-sm" onClick={() => boundaryHere(which)} aria-label={`${which} at the playhead`} title="Set to the playhead (Alt [ / Alt ])">
          {which === "start" ? <ArrowLeftToLine /> : <ArrowRightToLine />}
        </Button>
        <Button variant="secondary" size="icon-sm" onClick={() => nudge(which, 0.1)} aria-label={`${which} 0.1 s later`}><Plus /></Button>
      </div>
    </div>
  );
}

/** Everything about the active segment. Used in the desktop inspector and the phone sheet. */
export function SegmentPanel({ phone = false }: { phone?: boolean }) {
  const seg = useEditor((s) => activeSeg(s));
  const index = useEditor((s) => s.segs.findIndex((x) => x.id === s.activeId));
  const lanes = useLanes();
  if (!seg) return <p className="py-10 text-center text-sm text-muted-foreground">Select a segment.</p>;
  return (
    <div className="grid gap-5">
      {!phone && (
        <div className="flex items-center justify-between">
          <MonoLabel>Segment {index + 1} · properties</MonoLabel>
          <span className="font-mono text-[11px] text-muted-foreground tabular">{(seg.end - seg.start).toFixed(1)} s</span>
        </div>
      )}
      <div className="rounded-2xl bg-secondary/70 p-2">
        <SegmentWaveCanvas className={cn("block w-full touch-none", phone ? "h-28" : "h-24")} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <TimeField which="start" />
        <TimeField which="end" />
      </div>
      <div className="grid gap-2">
        <MonoLabel className="text-[10px]">Speaker</MonoLabel>
        <SpeakerOptions seg={seg} lanes={lanes} chips />
      </div>
      <div className="grid gap-1 rounded-2xl border bg-card px-4 py-1">
        <label className="flex items-center justify-between py-2.5">
          <span className="text-sm">Overlaps another speaker</span>
          <Switch checked={seg.overlap} onCheckedChange={() => toggleOverlap(seg.id)} />
        </label>
        <div className="h-px bg-border" />
        <label className="flex items-center justify-between py-2.5">
          <span className="text-sm">Checked</span>
          <Switch checked={seg.checked} onCheckedChange={() => toggleChecked(seg.id)} />
        </label>
      </div>
      <div className="grid gap-2">
        <MonoLabel className="text-[10px]">Insert</MonoLabel>
        <div className="flex flex-wrap gap-1.5">
          {TAGS.map(([label, run]) => (
            <button key={label} onPointerDown={(e) => e.preventDefault()} onClick={run}
              className="h-8 rounded-full border bg-card px-3 text-[13px] transition hover:bg-accent">{label}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="justify-start" onClick={() => split(caretInActive())}><Scissors /> Split here</Button>
        <Button variant="outline" className="justify-start" onClick={mergeNext}><Combine /> Merge next</Button>
        <Button variant="outline" className="justify-start" onClick={addAtPlayhead}><Plus /> Add at playhead</Button>
        <Button variant="outline" className="justify-start text-destructive hover:text-destructive" onClick={removeActive}><Trash2 /> Delete</Button>
      </div>
    </div>
  );
}

function caretInActive() {
  const el = document.querySelector<HTMLTextAreaElement>("textarea.transcript-text");
  return el && document.activeElement === el ? el.selectionStart : null;
}

export function SpeakersPanel() {
  const lanes = useLanes();
  const segs = useEditor((s) => s.segs);
  const roles = useEditor((s) => s.doc?.speakers);
  const dark = useDark();
  const stats: Record<string, { n: number; t: number }> = {};
  for (const s of segs) {
    const x = (stats[s.speaker] ||= { n: 0, t: 0 });
    x.n++;
    x.t += s.end - s.start;
  }
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      {lanes.map((sp, i) => {
        const special = sp === BACKGROUND || sp === UNSURE;
        return (
          <div key={sp} className={cn("flex items-center gap-3 px-3.5 py-2.5", i && "border-t")}>
            <i className="size-2.5 shrink-0 rounded-full" style={{ background: speakerColor(sp, lanes, dark).dot }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{sp === UNSURE ? "Unassigned" : sp}</p>
              <p className="font-mono text-[11px] text-muted-foreground tabular">{stats[sp]?.n || 0} seg · {fmtTime(stats[sp]?.t || 0, 0)}</p>
            </div>
            {special ? (
              <span className="font-mono text-[11px] text-muted-foreground">{sp === BACKGROUND ? "no text" : "assign"}</span>
            ) : (
              <Select value={roles?.[sp]?.role || "none"}
                onValueChange={(v) => (v.startsWith("merge:") ? mergeSpeaker(sp, v.slice(6)) : setRole(sp, v === "none" ? "" : v))}>
                <SelectTrigger size="sm" className="h-8 w-28 rounded-full bg-card text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="none">Role…</SelectItem>
                  {ROLES.map((r: string) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  {lanes.filter((y) => y !== sp && y !== UNSURE).map((y) => (
                    <SelectItem key={`m-${y}`} value={`merge:${y}`}>Merge into {y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NotesField() {
  const notes = useEditor((s) => s.doc?.notes || "");
  const [v, setV] = useState(notes);
  useEffect(() => setV(notes), [notes]);
  return (
    <Textarea value={v} onChange={(e) => { setV(e.target.value); setNotes(e.target.value); }} placeholder="Noise, a doctor’s habit, a question for the guideline…"
      className="min-h-20 rounded-2xl text-sm" />
  );
}

export function FilePanel() {
  const doc = useEditor((s) => s.doc);
  const mode = useEditor((s) => s.mode);
  const ownerName = useEditor((s) => s.ownerName);
  const segs = useEditor((s) => s.segs);
  if (!doc) return null;
  const n = segs.filter((s) => s.checked).length;
  return (
    <div className="grid gap-5">
      <MonoLabel>File</MonoLabel>
      <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
        <StatusPad status={doc.status} progress={segs.length ? n / segs.length : 0} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{STATUS_LABEL[doc.status]}{mode === "review" && ` · ${ownerName}`}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground tabular">
            worked {fmtTime(doc.time_spent_sec || 0, 0)}{doc.review_time_sec ? ` · reviewed ${fmtTime(doc.review_time_sec, 0)}` : ""}
          </p>
        </div>
      </div>
      <div className="grid gap-2">
        <MonoLabel className="text-[10px]">Speakers and roles</MonoLabel>
        <SpeakersPanel />
      </div>
      <div className="grid gap-2">
        <MonoLabel className="text-[10px]">Notes</MonoLabel>
        <NotesField />
      </div>
      <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">started from {doc.source}</p>
    </div>
  );
}

export function Inspector() {
  return (
    <div className="grid gap-8 p-5">
      <SegmentPanel />
      <div className="h-px bg-border" />
      <FilePanel />
    </div>
  );
}

/** Phone: the segment's properties in a bottom sheet, like an instrument lane editor. */
export function SegmentSheet() {
  const open = useEditor((s) => s.panel === "sheet");
  const index = useEditor((s) => s.segs.findIndex((x) => x.id === s.activeId));
  const seg = useEditor((s) => activeSeg(s));
  return (
    <Drawer open={open} onOpenChange={(o) => useEditor.setState({ panel: o ? "sheet" : null })}>
      <DrawerContent className="max-h-[92dvh] rounded-t-[28px]">
        <DrawerHeader className="flex-row items-center justify-between px-5 pt-2 pb-2 text-left">
          <div>
            <MonoLabel>Segment {index + 1} · properties</MonoLabel>
            <DrawerTitle className="mt-0.5 text-left text-lg tracking-tight">{seg ? `${fmtTime(seg.start, 1)} – ${fmtTime(seg.end, 1)}` : ""}</DrawerTitle>
            <DrawerDescription className="sr-only">Edit the segment’s times, speaker and flags</DrawerDescription>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={undo} aria-label="Undo"><Undo2 /></Button>
            <Button variant="ghost" size="icon" onClick={redo} aria-label="Redo"><Redo2 /></Button>
          </div>
        </DrawerHeader>
        <div className="overflow-y-auto px-5 pt-1 pb-4">
          <SegmentPanel phone />
        </div>
        <div className="flex items-center gap-2 border-t px-5 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]">
          <Button variant="outline" className="h-11 flex-1" onClick={() => useEditor.setState({ panel: null })}>Done</Button>
          <Button variant="ink" className="h-11 flex-1" onClick={replay}><Play fill="currentColor" /> Play segment</Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function SheetLabel({ children }: { children: React.ReactNode }) {
  return <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{children}</Label>;
}
