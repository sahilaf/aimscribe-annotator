import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Check, Play, SlidersHorizontal, RotateCcw, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditor, setActive, setText, toggleChecked, setSpeaker, visibleSegs, playSeg, replay, setFilter, type Filter } from "@/state/editor";
import { renderMarked, stripMarks, hasFlags, BACKGROUND, UNSURE } from "@/lib/formats.js";
import { fmtTime } from "@/lib/util.js";
import { speakerColor } from "./colors";
import { useLanes } from "./TimelineView";
import { useDark } from "@/hooks/use-media";
import { cn } from "@/lib/utils";
import type { Seg } from "./types";

const pref = (k: string, d: string) => localStorage.getItem("aimscribe:" + k) ?? d;
let pendingCaret: number | null = null; // where a click on the plain text should put the cursor

/** Character offset of a click inside `root`'s text, so the text box opens with the cursor there. */
function caretFromPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null, off = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; off = p.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  }
  if (!node || !root.contains(node)) return null;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n === node) return total + off;
    total += n.textContent?.length || 0;
  }
  return null;
}

export function EditorFilters({ className }: { className?: string }) {
  const filter = useEditor((s) => s.filter);
  const segs = useEditor((s) => s.segs);
  const counts = useMemo(() => ({ all: segs.length, unchecked: segs.filter((s) => !s.checked).length, flagged: segs.filter(hasFlags).length }), [segs]);
  const done = segs.length - counts.unchecked;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <ToggleGroup type="single" spacing={1} value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
        {([["all", "All"], ["unchecked", "To check"], ["flagged", "Flagged"]] as const).map(([k, label]) => (
          <ToggleGroupItem key={k} value={k}
            className="h-8 rounded-full px-3 text-[13px] data-[state=on]:bg-ink data-[state=on]:text-ink-foreground">
            {label} <span className="font-mono text-[11px] opacity-60">{counts[k]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="ml-auto flex items-center gap-2.5">
        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-secondary sm:block">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${segs.length ? (done / segs.length) * 100 : 0}%` }} />
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular">{done}/{segs.length}</span>
      </div>
    </div>
  );
}

export function TranscriptList({ variant, scrollRef }: { variant: "desktop" | "mobile"; scrollRef: React.RefObject<HTMLElement | null> }) {
  const segs = useEditor((s) => s.segs);
  const filter = useEditor((s) => s.filter);
  const activeId = useEditor((s) => s.activeId);
  const scrollTick = useEditor((s) => s.scrollTick);
  const focusTick = useEditor((s) => s.focusTick);
  const roles = useEditor((s) => s.doc?.speakers);
  const lanes = useLanes();
  const lanesKey = lanes.join("|");
  const index = useMemo(() => new Map(segs.map((s, i) => [s.id, i])), [segs]);
  const visible = useMemo(() => visibleSegs(segs, filter), [segs, filter]);

  // Scroll the active row into view when moving with Next/Previous or the timeline.
  useEffect(() => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-seg="${activeId}"]`);
    if (!root || !el) return;
    const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect();
    if (r.top < rr.top + 60 || r.bottom > rr.bottom - (variant === "mobile" ? 110 : 40)) {
      root.scrollTo({ top: root.scrollTop + r.top - rr.top - (variant === "mobile" ? 70 : rr.height / 3), behavior: "smooth" });
    }
  }, [scrollTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!segs.length) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-3xl border border-dashed p-8 text-center">
        <p className="font-medium">No segments yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Play the audio, then add a segment where someone speaks.</p>
      </div>
    );
  }
  if (!visible.length) return <p className="mt-16 text-center text-sm text-muted-foreground">Nothing left with this filter.</p>;

  return (
    <div className={variant === "desktop" ? "mx-auto max-w-[860px] space-y-1 px-6 pt-4 pb-24" : "space-y-0.5 pt-2 pb-32"}>
      {visible.map((s) => (
        <SegmentRow key={s.id} seg={s} n={(index.get(s.id) ?? 0) + 1} active={s.id === activeId} variant={variant}
          lanesKey={lanesKey} role={roles?.[s.speaker]?.role || ""} focusTick={s.id === activeId ? focusTick : 0} />
      ))}
    </div>
  );
}

interface RowProps { seg: Seg; n: number; active: boolean; variant: "desktop" | "mobile"; lanesKey: string; role: string; focusTick: number }

const SegmentRow = memo(function SegmentRow({ seg, n, active, variant, lanesKey, role, focusTick }: RowProps) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const dark = useDark();
  const lanes = lanesKey.split("|");
  const unchanged = !!seg.draft && stripMarks(seg.draft) === seg.text;
  const html = useMemo(() => renderMarked(unchanged ? seg.draft : seg.text), [seg.draft, seg.text, unchanged]);
  const showDraft = active && !!seg.draft && !unchanged;
  const flagged = hasFlags(seg) && !seg.checked;

  useLayoutEffect(() => {
    if (!active || !ta.current) return;
    if (pendingCaret != null || focusTick) {
      const el = ta.current;
      el.focus({ preventScroll: true });
      const at = pendingCaret ?? el.value.length;
      el.setSelectionRange(at, at);
      pendingCaret = null;
    }
  }, [active, focusTick]);

  const activate = (e: React.MouseEvent) => {
    if (active) return;
    const coarse = matchMedia("(pointer: coarse)").matches;
    if (!coarse && textRef.current && textRef.current.contains(e.target as Node)) {
      pendingCaret = caretFromPoint(textRef.current, e.clientX, e.clientY);
      setActive(seg.id);
      return;
    }
    setActive(seg.id, { play: pref("tapplay", "1") === "1" });
  };

  const text = active ? (
    <textarea
      ref={ta}
      value={seg.text}
      lang="bn"
      rows={1}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      placeholder={seg.speaker === BACKGROUND ? "Background voice: no text" : "Type what was said"}
      onChange={(e) => setText(seg.id, e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
      className="transcript-text -mx-2 block w-[calc(100%+1rem)] resize-none rounded-xl border-0 bg-secondary/70 px-2 py-0.5 outline-none focus:bg-secondary focus:ring-2 focus:ring-primary/25"
    />
  ) : (
    <p ref={textRef} className={cn("transcript-text break-words", !seg.text && "text-muted-foreground italic")}
      dangerouslySetInnerHTML={{ __html: html || (seg.speaker === BACKGROUND ? "background voice" : "empty") }} />
  );

  const draft = showDraft && (
    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
      <span className="mr-2 font-mono text-[10px] uppercase tracking-wider">Draft</span>
      <span dangerouslySetInnerHTML={{ __html: renderMarked(seg.draft) }} />
    </p>
  );

  const check = (
    <button
      onClick={(e) => { e.stopPropagation(); toggleChecked(seg.id); }}
      aria-label={seg.checked ? "Checked" : "Mark as checked"}
      aria-pressed={seg.checked}
      className={cn("grid size-8 shrink-0 place-items-center rounded-full border transition-all",
        seg.checked ? "border-ink bg-ink text-ink-foreground" : "border-border text-transparent hover:border-muted-foreground hover:text-muted-foreground", active && !seg.checked && "text-muted-foreground")}
    >
      <Check className="size-4" strokeWidth={2.5} />
    </button>
  );

  const color = speakerColor(seg.speaker, lanes, dark);

  if (variant === "desktop") {
    return (
      <div data-seg={seg.id} onClick={activate}
        className={cn("group grid cursor-default grid-cols-[148px_1fr_40px] gap-x-5 rounded-2xl px-4 py-3.5 transition-colors",
          active ? "bg-card shadow-soft ring-1 ring-primary/20" : "hover:bg-card/60")}>
        <div className="pt-[22px]">
          <SpeakerTag seg={seg} lanes={lanes} role={role} color={color.dot} />
        </div>
        <div className="min-w-0 border-l pl-5">
          <div className="flex h-5 items-center gap-2 font-mono text-[11px] text-muted-foreground tabular">
            <button className={cn("grid size-5 place-items-center rounded-full transition", active ? "bg-ink text-ink-foreground" : "opacity-0 group-hover:opacity-100 hover:bg-secondary")}
              onClick={(e) => { e.stopPropagation(); setActive(seg.id); playSeg(seg); }} aria-label="Play segment">
              <Play className="size-2.5" fill="currentColor" />
            </button>
            <span>{fmtTime(seg.start, 2)}</span>
            <span className="opacity-50">#{n}</span>
            {seg.overlap && <span className="rounded-full bg-warning/15 px-1.5 text-[10px] text-warning">overlap</span>}
            {flagged && <i className="size-1.5 rounded-full bg-primary" title="Worth a listen: the draft model was unsure here" />}
          </div>
          <div className="mt-1">{text}</div>
          {draft}
          <div className="mt-1 font-mono text-[11px] text-muted-foreground tabular">{fmtTime(seg.end, 2)}</div>
        </div>
        <div className="pt-[18px]">{check}</div>
      </div>
    );
  }

  // phone: timestamp gutter and a thin time line, like a voice-notes app
  return (
    <div data-seg={seg.id} onClick={activate} className="grid grid-cols-[52px_1fr] gap-x-1 pr-3">
      <div className="relative pt-3.5 pl-3">
        <span className={cn("font-mono text-[10.5px] tabular", active ? "text-foreground" : "text-muted-foreground")}>{fmtTime(seg.start, 0)}</span>
        <span className="absolute top-10 bottom-0 left-[22px] w-px bg-border" />
        {active && <span className="absolute top-[40px] left-[18.5px] size-2 rounded-full bg-primary ring-4 ring-background" />}
      </div>
      <div className={cn("min-w-0 rounded-2xl px-3 py-2.5 transition-colors", active && "bg-card shadow-soft ring-1 ring-primary/15")}>
        <div className="mb-1 flex items-center gap-2">
          <SpeakerTag seg={seg} lanes={lanes} role={role} color={color.dot} compact />
          {seg.overlap && <span className="rounded-full bg-warning/15 px-1.5 font-mono text-[10px] text-warning">overlap</span>}
          {flagged && <i className="size-1.5 rounded-full bg-primary" />}
          <span className="flex-1" />
          {check}
        </div>
        {text}
        {draft}
        {active && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" className="h-9" onClick={(e) => { e.stopPropagation(); useEditor.setState({ panel: "sheet" }); }}>
              <SlidersHorizontal /> Edit segment
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={(e) => { e.stopPropagation(); replay(); }}>
              <RotateCcw /> Replay
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

/** Speaker name with its colour; opens a picker. */
function SpeakerTag({ seg, lanes, role, color, compact = false }: { seg: Seg; lanes: string[]; role: string; color: string; compact?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()}
          className={cn("flex max-w-full items-center gap-2 rounded-full text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/30", compact ? "h-6 pr-1" : "-ml-2 px-2 py-1 hover:bg-secondary")}>
          <i className={cn("shrink-0 rounded-full", compact ? "size-2" : "size-2.5")} style={{ background: color }} />
          <span className="min-w-0">
            <span className={cn("block truncate font-medium", compact ? "text-[13px]" : "text-sm")}>
              {seg.speaker === UNSURE ? "Who?" : seg.speaker}
              {compact && role && <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">{role}</span>}
            </span>
            {!compact && role && <span className="block truncate font-mono text-[11px] text-muted-foreground">{role}</span>}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 rounded-2xl p-1.5" onClick={(e) => e.stopPropagation()}>
        <SpeakerOptions seg={seg} lanes={lanes} />
      </PopoverContent>
    </Popover>
  );
}

export function SpeakerOptions({ seg, lanes, chips = false }: { seg: Seg; lanes: string[]; chips?: boolean }) {
  const roles = useEditor((s) => s.doc?.speakers);
  const dark = useDark();
  const real = lanes.filter((x) => x !== BACKGROUND && x !== UNSURE);
  let n = real.length + 1;
  while (real.includes(`S${n}`)) n++;
  const options = [...real, `S${n}`, BACKGROUND];
  if (chips) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((x) => {
          const on = seg.speaker === x;
          const isNew = x === `S${n}`;
          return (
            <button key={x} onClick={() => setSpeaker(seg.id, x)}
              className={cn("inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition",
                on ? "border-ink bg-ink text-ink-foreground" : "bg-card hover:bg-accent")}>
              {isNew ? <Plus className="size-3.5" /> : <i className="size-2 rounded-full" style={{ background: speakerColor(x, [...real, `S${n}`], dark).dot }} />}
              {isNew ? "New" : x}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="grid">
      {options.map((x, i) => (
        <button key={x} onClick={() => setSpeaker(seg.id, x)}
          className={cn("flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm hover:bg-accent", seg.speaker === x && "bg-accent")}>
          {x === `S${n}` ? <UserRound className="size-3.5 text-muted-foreground" /> : <i className="size-2.5 rounded-full" style={{ background: speakerColor(x, [...real, `S${n}`], dark).dot }} />}
          <span className="flex-1 font-medium">{x === `S${n}` ? `${x} · new speaker` : x}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{x === BACKGROUND ? "no text" : roles?.[x]?.role || (i < 9 ? `Alt ${i + 1}` : "")}</span>
          {seg.speaker === x && <Check className="size-3.5" />}
        </button>
      ))}
    </div>
  );
}
