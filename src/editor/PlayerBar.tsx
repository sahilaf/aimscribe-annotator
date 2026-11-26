import { Check, Pause, Play, Plus, Repeat, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { player, usePlaying, useRate, useTime } from "./player";
import { useTimelineView } from "./TimelineView";
import { useEditor, togglePlay, step, checkAndNext, addAtPlayhead, setLoop } from "@/state/editor";
import { fmtTime } from "@/lib/util.js";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const RATES = [0.6, 0.75, 0.9, 1, 1.25, 1.5];

function Tip({ label, keys, children }: { label: string; keys?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">{label}{keys && <span className="font-mono text-[10px] opacity-60">{keys}</span>}</TooltipContent>
    </Tooltip>
  );
}

function Clock({ className }: { className?: string }) {
  const t = useTime();
  const duration = useEditor((s) => s.duration);
  return (
    <span className={cn("font-mono text-[13px] tabular", className)}>
      {fmtTime(t, 1)}<span className="text-muted-foreground"> / {fmtTime(duration, 0)}</span>
    </span>
  );
}

function RateMenu({ compact = false }: { compact?: boolean }) {
  const rate = useRate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? "icon" : "sm"} className="font-mono text-xs tabular" aria-label="Playback speed">
          {rate}×
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="min-w-24 rounded-2xl p-1.5">
        <DropdownMenuRadioGroup value={String(rate)} onValueChange={(v) => player.setRate(+v)}>
          {RATES.map((r) => <DropdownMenuRadioItem key={r} value={String(r)} className="rounded-lg font-mono text-xs">{r}×</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlayButton({ size = "size-11" }: { size?: string }) {
  const playing = usePlaying();
  return (
    <Tip label={playing ? "Pause" : "Play segment"} keys="Ctrl Space">
      <Button variant="ink" className={cn(size, "rounded-full p-0 [&_svg]:size-[18px]")} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="ml-0.5" />}
      </Button>
    </Tip>
  );
}

/** Desktop: the row under the timeline. */
export function TransportRow() {
  const zoom = useTimelineView((s) => s.zoom);
  const tl = useTimelineView((s) => s.tl);
  const loop = useEditor((s) => s.loop);
  return (
    <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 border-t px-4">
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" onClick={() => tl?.zoom(1.6)} aria-label="Zoom out"><ZoomOut /></Button>
        <Slider value={[zoom * 100]} onValueChange={([v]) => tl?.setZoomLevel(v / 100)} className="w-32" aria-label="Zoom" />
        <Button variant="ghost" size="icon-sm" onClick={() => tl?.zoom(0.6)} aria-label="Zoom in"><ZoomIn /></Button>
      </div>
      <div className="flex items-center gap-1.5">
        <RateMenu />
        <Tip label="Loop segment">
          <Button variant="ghost" size="icon" onClick={() => setLoop(!loop)} aria-pressed={loop} className={cn(loop && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}><Repeat /></Button>
        </Tip>
        <Tip label="Previous segment" keys="Ctrl ↑"><Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous segment"><SkipBack /></Button></Tip>
        <PlayButton />
        <Tip label="Next segment" keys="Ctrl ↓"><Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next segment"><SkipForward /></Button></Tip>
        <Clock className="ml-2 w-36" />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={addAtPlayhead}><Plus /> Add segment</Button>
        <Tip label="Tick and go to the next segment" keys="Ctrl Enter">
          <Button className="h-10 px-5" onClick={checkAndNext}><Check strokeWidth={2.5} /> Check &amp; next</Button>
        </Tip>
      </div>
    </div>
  );
}

/** Phone: a floating pill, like a music player. */
export function PillPlayer() {
  const t = useTime(8);
  const duration = useEditor((s) => s.duration);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-1 rounded-full border bg-card/95 p-1.5 shadow-soft backdrop-blur-xl">
        <Button variant="ghost" size="icon" className="size-10" onClick={() => step(-1)} aria-label="Previous segment"><SkipBack /></Button>
        <PlayButton size="size-12" />
        <Button variant="ghost" size="icon" className="size-10" onClick={() => step(1)} aria-label="Next segment"><SkipForward /></Button>
        <div className="mx-1 min-w-0 flex-1">
          <div className="font-mono text-xs tabular">{fmtTime(t, 1)}<span className="text-muted-foreground"> / {fmtTime(duration, 0)}</span></div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-ink" style={{ width: `${duration ? (t / duration) * 100 : 0}%` }} />
          </div>
        </div>
        <RateMenu compact />
        <Button className="size-12 rounded-full p-0 [&_svg]:size-5" onClick={checkAndNext} aria-label="Tick and next">
          <Check strokeWidth={2.75} />
        </Button>
      </div>
    </div>
  );
}
