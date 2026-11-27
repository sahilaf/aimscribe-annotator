import { useEffect, useState } from "react";
import { ArrowRight, FileText, PencilLine, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSession } from "@/state/session";
import { startEditor } from "@/state/editor";
import { fmtAgo } from "@/lib/util.js";
import { Responsive } from "./Responsive";
import { Initials, STATUS_LABEL } from "./bits";
import type { Item, StartPlan } from "@/editor/types";

/** How to open a file that already has annotations: continue, review, or start my own. */
export function OpenFileDialog() {
  const item = useSession((s) => s.openFor);
  const close = () => useSession.setState({ openFor: null });
  return (
    <Responsive open={!!item} onOpenChange={(o) => !o && close()} eyebrow="Open file" title={item?.base || ""}>
      {item && <Choices item={item} onPick={(plan) => { close(); startEditor(item, plan); }} />}
    </Responsive>
  );
}

export function StartFrom({ item, onPick, cta = "Start my annotation" }: { item: Item; onPick: (p: StartPlan) => void; cta?: string }) {
  const others = item.outputs;
  const [src, setSrc] = useState(item.sources.length ? "s0" : others.length ? "o0" : "blank");
  const [timing, setTiming] = useState(false);
  useEffect(() => setSrc(item.sources.length ? "s0" : others.length ? "o0" : "blank"), [item]); // eslint-disable-line
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Start from</Label>
        <Select value={src} onValueChange={setSrc}>
          <SelectTrigger className="h-11 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
          <SelectContent className="rounded-xl">
            {item.sources.map((s, i) => <SelectItem key={s.fileId} value={`s${i}`}>Draft · {s.label}</SelectItem>)}
            {others.map((o, i) => <SelectItem key={o.fileId} value={`o${i}`}>{o.annotatorName}’s annotation</SelectItem>)}
            <SelectItem value="blank">Blank: I add segments myself</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {src !== "blank" && (
        <div className="flex items-start justify-between gap-4 rounded-2xl bg-secondary px-4 py-3">
          <div>
            <Label htmlFor="timing" className="font-medium">Hide draft text</Label>
            <p className="mt-0.5 text-sm text-muted-foreground">Keep the timings only, for an independent transcription.</p>
          </div>
          <Switch id="timing" checked={timing} onCheckedChange={setTiming} className="mt-1" />
        </div>
      )}
      <Button variant="ink" className="h-11" onClick={() => onPick({
        kind: "new",
        source: src[0] === "s" ? item.sources[+src.slice(1)] : null,
        from: src[0] === "o" ? others[+src.slice(1)].fileId : null,
        blank: src === "blank", timing,
      })}>
        {cta} <ArrowRight />
      </Button>
    </div>
  );
}

function Choices({ item, onPick }: { item: Item; onPick: (p: StartPlan) => void }) {
  const me = useSession((s) => s.user!.email);
  const own = item.outputs.find((o) => o.annotator === me);
  const others = item.outputs.filter((o) => o !== own);
  return (
    <div className="grid gap-2.5">
      {own && (
        <button onClick={() => onPick({ kind: "own", output: own })}
          className="flex items-center gap-4 rounded-2xl bg-ink p-4 text-left text-ink-foreground transition hover:bg-ink/90">
          <PencilLine className="size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Continue my annotation</p>
            <p className="font-mono text-xs opacity-70">{STATUS_LABEL[own.status]} · {own.checked}/{own.total} checked · {fmtAgo(own.updated)}</p>
          </div>
          <ArrowRight className="size-4 opacity-70" />
        </button>
      )}
      {others.map((o) => (
        <button key={o.fileId} onClick={() => onPick({ kind: "review", output: o })}
          className="flex items-center gap-4 rounded-2xl border bg-card p-4 text-left transition hover:bg-accent">
          <Initials name={o.annotatorName} className="size-9 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Review {o.annotatorName}’s annotation</p>
            <p className="font-mono text-xs text-muted-foreground">{STATUS_LABEL[o.status]} · {o.checked}/{o.total} checked · {fmtAgo(o.updated)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Your edits are saved into their file.</p>
          </div>
          <ScanSearch className="size-4 text-muted-foreground" />
        </button>
      ))}
      {!own && (item.access?.annotate ?? true) && (
        <div className="mt-3 rounded-2xl border border-dashed p-4">
          <p className="mb-3 flex items-center gap-2 font-medium"><FileText className="size-4" /> Or start your own</p>
          <StartFrom item={item} onPick={onPick} />
        </div>
      )}
    </div>
  );
}
