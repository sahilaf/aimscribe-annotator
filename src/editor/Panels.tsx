import { useMemo } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Responsive } from "@/components/Responsive";
import { StartFrom } from "@/components/OpenFileDialog";
import { useEditor, setActive, setFilter, restart, renumberSpeakers } from "@/state/editor";
import { checkDoc } from "@/lib/formats.js";
import { fmtTime } from "@/lib/util.js";
import { SpeakersPanel } from "./Inspector";
import { cn } from "@/lib/utils";

const close = () => useEditor.setState({ panel: null });

interface Issue { i: number; level: "error" | "warn"; msg: string }

export function useIssues() {
  const segs = useEditor((s) => s.segs);
  return useMemo(() => checkDoc({ segments: segs }) as Issue[], [segs]);
}

export function ChecksDialog() {
  const open = useEditor((s) => s.panel === "checks");
  const segs = useEditor((s) => s.segs);
  const issues = useIssues();
  const errors = issues.filter((x) => x.level === "error");
  const warns = issues.filter((x) => x.level === "warn" && !x.msg.startsWith("not ticked"));
  const unticked = issues.length - errors.length - warns.length;
  const go = (i: number) => {
    close();
    setFilter("all");
    setActive(segs[i].id, { scroll: true, focus: !matchMedia("(pointer: coarse)").matches });
  };
  const Row = ({ x }: { x: Issue }) => (
    <button onClick={() => go(x.i)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-accent">
      {x.level === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
      <span className="min-w-0 flex-1 text-sm">{x.msg}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">#{x.i + 1} · {fmtTime(segs[x.i]?.start, 0)}</span>
    </button>
  );
  return (
    <Responsive open={open} onOpenChange={(o) => !o && close()} eyebrow="Automatic checks" title={errors.length ? `${errors.length} to fix` : "Looks good"}
      description="The same rules the import script applies: Bangla script only, numbers as words, every segment with a speaker, nothing over 30 s.">
      <div className="grid gap-1">
        {!errors.length && !warns.length && (
          <div className="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm"><CircleCheck className="size-4 text-success" /> No problems found.</div>
        )}
        {errors.map((x, k) => <Row key={`e${k}`} x={x} />)}
        {warns.length > 0 && <p className="mt-3 mb-1 px-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Worth a look</p>}
        {warns.map((x, k) => <Row key={`w${k}`} x={x} />)}
        {unticked > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-secondary px-4 py-3 text-sm">
            <span>{unticked} segment{unticked > 1 ? "s" : ""} not ticked yet</span>
            <Button size="sm" variant="outline" onClick={() => { setFilter("unchecked"); close(); }}>Show them</Button>
          </div>
        )}
      </div>
    </Responsive>
  );
}

export function SpeakersDialog() {
  const open = useEditor((s) => s.panel === "speakers");
  return (
    <Responsive open={open} onOpenChange={(o) => !o && close()} eyebrow="This file" title="Speakers and roles"
      description="Mark each person’s role once. IDs go S1, S2, S3 in order of first speech; other people in the room are পটভূমি.">
      <div className="grid gap-3">
        <SpeakersPanel />
        <Button variant="outline" onClick={renumberSpeakers}>Renumber S1, S2… by first speech</Button>
      </div>
    </Responsive>
  );
}

const KEYS: [string[], string][] = [
  [["Ctrl", "Space"], "Play or pause in the segment"], [["Esc"], "Replay the segment"],
  [["Ctrl", "Enter"], "Tick, next segment, play"], [["Ctrl", "↓"], "Next segment"], [["Ctrl", "↑"], "Previous segment"],
  [["Ctrl", "⇧", "←/→"], "Back or forward 2 s"], [["Alt", "["], "Start at the playhead"], [["Alt", "]"], "End at the playhead"],
  [["Alt", "1…9"], "Speaker S1…S9"], [["Alt", "0"], "Background voice"], [["Alt", "O"], "Toggle overlap"], [["Alt", "U"], "Insert [অস্পষ্ট]"],
  [["Alt", "S"], "Split at the playhead"], [["Alt", "M"], "Merge with next"], [["Ctrl", "S"], "Save to Drive now"],
  [["Ctrl", "Z"], "Undo (outside the text box)"], [["Ctrl", "⇧", "Z"], "Redo"],
];

export function KeysDialog() {
  const open = useEditor((s) => s.panel === "keys");
  return (
    <Responsive open={open} onOpenChange={(o) => !o && close()} eyebrow="Help" title="Keyboard and touch" wide>
      <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {KEYS.map(([k, v]) => (
          <div key={v} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
            <span className="text-muted-foreground">{v}</span>
            <span className="flex shrink-0 gap-1">{k.map((x) => <Kbd key={x}>{x}</Kbd>)}</span>
          </div>
        ))}
      </div>
      <p className={cn("mt-5 rounded-2xl bg-secondary p-4 text-sm leading-relaxed text-muted-foreground")}>
        On the waveform: drag the orange handles to move a segment’s start or end, tap to jump, drag to pan, pinch or scroll to zoom.
      </p>
    </Responsive>
  );
}

export function RestartDialog() {
  const open = useEditor((s) => s.panel === "restart");
  const item = useEditor((s) => s.item);
  return (
    <Responsive open={open} onOpenChange={(o) => !o && close()} eyebrow="Start again" title="Start from another draft"
      description="Replaces your work on this file the next time it saves. Your Drive file is reused, not duplicated.">
      {item && <StartFrom item={{ ...item, outputs: item.outputs.filter((o) => o.annotator !== useEditor.getState().owner) }}
        onPick={(p) => { close(); restart(p); }} cta="Start again" />}
    </Responsive>
  );
}
