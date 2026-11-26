import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { Timeline, SegmentWave, LAYOUT_COMPACT, LAYOUT_DESKTOP, timelineHeight } from "./timeline";
import { speakerColor } from "./colors";
import { player } from "./player";
import { useEditor, tapTimeline, moveBoundary, activeSeg } from "@/state/editor";
import { speakerList } from "@/lib/formats.js";
import { useDark } from "@/hooks/use-media";

const NONE: Record<string, { role: string }> = {};

// The zoom slider and the canvas share this.
export const useTimelineView = create<{ zoom: number; tl: Timeline | null }>(() => ({ zoom: 0, tl: null }));

export function useLanes() {
  const segs = useEditor((s) => s.segs);
  const speakers = useEditor((s) => s.doc?.speakers);
  return useMemo<string[]>(() => speakerList(segs, speakers || {}), [segs, speakers]);
}

export function TimelineCanvas({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tl = useRef<Timeline | null>(null);
  const L = compact ? LAYOUT_COMPACT : LAYOUT_DESKTOP;
  const segs = useEditor((s) => s.segs);
  const activeId = useEditor((s) => s.activeId);
  const peaks = useEditor((s) => s.peaks);
  const duration = useEditor((s) => s.duration);
  const scrollTick = useEditor((s) => s.scrollTick);
  const lanes = useLanes();
  const dark = useDark();

  useEffect(() => {
    const t = new Timeline(ref.current!, {
      onTap: tapTimeline,
      onBoundary: (id, which, time, done) => moveBoundary(id, which, time, done),
      onView: () => useTimelineView.setState({ zoom: t.zoomLevel }),
    }, L);
    tl.current = t;
    useTimelineView.setState({ tl: t });
    const off = player.onTime((x) => t.setTime(x, player.playing));
    return () => { off(); t.destroy(); useTimelineView.setState({ tl: null }); };
  }, [L]);

  useEffect(() => { tl.current?.setAudio(peaks, duration); }, [peaks, duration]);
  useEffect(() => { tl.current?.setSegments(segs, lanes, activeId); }, [segs, lanes, activeId]);
  useEffect(() => { tl.current?.showSegment(activeSeg()); }, [activeId, scrollTick]);
  useEffect(() => { tl.current?.draw(); }, [dark]);

  return <canvas ref={ref} style={{ height: timelineHeight(L, lanes.length) }} className="block w-full touch-none select-none" />;
}

/** Speaker names to the left of the desktop timeline, one row per lane. */
export function LaneLabels() {
  const lanes = useLanes();
  const roles = useEditor((s) => s.doc?.speakers) || NONE;
  const dark = useDark();
  const L = LAYOUT_DESKTOP;
  return (
    <div className="w-44 shrink-0 border-r pr-3" style={{ height: timelineHeight(L, lanes.length) }}>
      <div className="flex items-end pb-2 pl-4" style={{ height: L.mini + L.ruler + L.wave + L.pad }}>
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Speakers</span>
      </div>
      {lanes.map((sp) => (
        <div key={sp} className="flex items-center gap-2 pl-4" style={{ height: L.lane + L.gap }}>
          <i className="size-2.5 shrink-0 rounded-full" style={{ background: speakerColor(sp, lanes, dark).dot }} />
          <span className="truncate text-[13px] font-medium">{sp === "?" ? "Unassigned" : sp}</span>
          {roles[sp]?.role && <span className="truncate font-mono text-[11px] text-muted-foreground">{roles[sp].role}</span>}
        </div>
      ))}
    </div>
  );
}

/** The zoomed trimmer view of the active segment (inspector and phone sheet). */
export function SegmentWaveCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = useRef<SegmentWave | null>(null);
  const peaks = useEditor((s) => s.peaks);
  const duration = useEditor((s) => s.duration);
  const seg = useEditor((s) => s.segs.find((x) => x.id === s.activeId));
  const dark = useDark();
  useEffect(() => {
    const x = new SegmentWave(ref.current!);
    w.current = x;
    x.onBoundary = (which, t, done) => { const a = activeSeg(); if (a) moveBoundary(a.id, which, t, done); };
    x.onSeek = (t) => player.seek(t);
    const off = player.onTime((t) => x.setTime(t));
    return () => { off(); x.destroy(); };
  }, []);
  useEffect(() => { w.current?.set(peaks, duration, seg ? { id: seg.id, start: seg.start, end: seg.end } : null); }, [peaks, duration, seg, dark]);
  return <canvas ref={ref} className={className} data-vaul-no-drag="" />;
}
