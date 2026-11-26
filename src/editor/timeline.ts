// Canvas timeline: minimap, ruler with a playhead badge, bar waveform, and one lane per speaker
// with rounded segment blocks. The active block has grips you drag to move its start or end.
// Pointer events: mouse, pen and touch. One finger pans, two pinch-zoom, a tap seeks or selects.
import { clamp, fmtTime } from "@/lib/util.js";
import { speakerColor, isDark } from "./colors";

export interface TLSeg { id: string; start: number; end: number; speaker: string; checked: boolean }
export interface TLPeaks { peaks: Float32Array; perSec: number; duration: number }

export interface TLLayout { mini: number; ruler: number; wave: number; lane: number; gap: number; pad: number }
export const LAYOUT_DESKTOP: TLLayout = { mini: 10, ruler: 22, wave: 46, lane: 28, gap: 4, pad: 8 };
export const LAYOUT_COMPACT: TLLayout = { mini: 8, ruler: 18, wave: 30, lane: 13, gap: 3, pad: 6 };

export function timelineHeight(L: TLLayout, lanes: number) {
  return L.mini + L.ruler + L.wave + L.pad + Math.max(1, lanes) * (L.lane + L.gap) + 4;
}

interface Callbacks {
  onTap(t: number, segId: string | null): void;
  onBoundary(id: string, which: "start" | "end", t: number, done: boolean): void;
  onView?(view: { start: number; end: number }): void;
}

export class Timeline {
  c: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cb: Callbacks;
  L: TLLayout;
  duration = 0;
  peaks: TLPeaks | null = null;
  segs: TLSeg[] = [];
  lanes: string[] = [];
  activeId: string | null = null;
  t = 0;
  view = { start: 0, end: 20 };
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: string | null = null;
  private downAt: { x: number; y: number; view: { start: number; end: number } } | null = null;
  private pinch: { d: number; mid: number; view: { start: number; end: number } } | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  coarse = matchMedia("(pointer: coarse)").matches;

  constructor(canvas: HTMLCanvasElement, cb: Callbacks, layout: TLLayout) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cb = cb;
    this.L = layout;
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.cancel);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    this.c.removeEventListener("pointerdown", this.down);
    this.c.removeEventListener("pointermove", this.move);
    this.c.removeEventListener("pointerup", this.up);
    this.c.removeEventListener("pointercancel", this.cancel);
    this.c.removeEventListener("wheel", this.wheel);
  }

  setAudio(peaks: TLPeaks | null, duration: number) {
    this.peaks = peaks;
    this.duration = duration || peaks?.duration || 0;
    this.view = { start: 0, end: Math.min(this.duration || 20, 24) };
    this.draw();
  }

  setSegments(segs: TLSeg[], lanes: string[], activeId: string | null) {
    this.segs = segs;
    this.lanes = lanes;
    this.activeId = activeId;
    this.draw();
  }

  get span() { return this.view.end - this.view.start; }
  get W() { return this.c.clientWidth; }
  get H() { return this.c.clientHeight; }
  X(t: number) { return ((t - this.view.start) / this.span) * this.W; }
  T(x: number) { return this.view.start + (x / this.W) * this.span; }
  get waveTop() { return this.L.mini + this.L.ruler; }
  get lanesTop() { return this.waveTop + this.L.wave + this.L.pad; }
  laneY(i: number) { return this.lanesTop + i * (this.L.lane + this.L.gap); }
  get active() { return this.segs.find((s) => s.id === this.activeId); }

  /** Bring a segment into view with context, keeping the zoom when it already fits. */
  showSegment(seg: { start: number; end: number } | undefined, force = false) {
    if (!seg) return;
    const len = seg.end - seg.start;
    const fits = seg.start >= this.view.start && seg.end <= this.view.end;
    if (fits && !force && this.span < Math.max(30, len * 6)) return this.draw();
    const span = clamp(force ? len * 1.6 + 2 : Math.max(this.span, len + 4), 3, Math.max(3, this.duration || 3));
    const mid = (seg.start + seg.end) / 2;
    this.setView(mid - span / 2, mid + span / 2);
  }

  setView(a: number, b: number) {
    const maxSpan = Math.max(1, this.duration || 20);
    const span = clamp(b - a, 0.8, maxSpan);
    a = clamp(a, 0, Math.max(0, (this.duration || span) - span));
    this.view = { start: a, end: a + span };
    this.draw();
    this.cb.onView?.(this.view);
  }

  zoom(f: number, center?: number) {
    const c = center ?? (this.t >= this.view.start && this.t <= this.view.end ? this.t : (this.view.start + this.view.end) / 2);
    const span = this.span * f;
    const r = (c - this.view.start) / this.span;
    this.setView(c - r * span, c - r * span + span);
  }

  /** Zoom as a 0..1 slider value (0 = whole file, 1 = 2 seconds). */
  get zoomLevel() {
    const max = Math.max(2.01, this.duration);
    return clamp(Math.log(max / this.span) / Math.log(max / 2), 0, 1);
  }
  setZoomLevel(z: number) {
    const max = Math.max(2.01, this.duration);
    this.zoom(max / Math.pow(max / 2, z) / this.span);
  }

  setTime(t: number, follow: boolean) {
    this.t = t;
    if (follow && (t > this.view.end - this.span * 0.04 || t < this.view.start)) {
      this.setView(t - this.span * 0.1, t + this.span * 0.9);
      return;
    }
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.c.width = Math.round(this.W * dpr);
    this.c.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paint();
  }

  // ---------------------------------------------------------------- input
  private local(e: PointerEvent | WheelEvent) {
    const r = this.c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    this.c.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: this.T((a.x + b.x) / 2), view: { ...this.view } };
      this.mode = "pinch";
      return;
    }
    if (p.y < this.L.mini + 2) {
      this.mode = "mini";
      this.jump(p.x);
      return;
    }
    const s = this.active;
    if (s && p.y >= this.waveTop) {
      const tol = this.coarse ? 22 : 10;
      const ds = Math.abs(p.x - this.X(s.start)), de = Math.abs(p.x - this.X(s.end));
      if (Math.min(ds, de) <= tol) {
        this.mode = ds < de || (ds === de && p.x < this.X(s.start)) ? "start" : "end";
        return;
      }
    }
    this.mode = "tap";
    this.downAt = { ...p, view: { ...this.view } };
  };

  private move = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) {
      this.hover(e);
      return;
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.mode === "pinch" && this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const span = (this.pinch.view.end - this.pinch.view.start) * (this.pinch.d / d);
      const r = (a.x + b.x) / 2 / this.W;
      this.setView(this.pinch.mid - r * span, this.pinch.mid - r * span + span);
    } else if (this.mode === "mini") this.jump(p.x);
    else if ((this.mode === "start" || this.mode === "end") && this.activeId) {
      this.cb.onBoundary(this.activeId, this.mode, clamp(this.T(p.x), 0, this.duration || Infinity), false);
    } else if (this.mode === "tap" && this.downAt && Math.abs(p.x - this.downAt.x) > 6) this.mode = "pan";
    if (this.mode === "pan" && this.downAt) {
      const dt = ((p.x - this.downAt.x) / this.W) * (this.downAt.view.end - this.downAt.view.start);
      this.setView(this.downAt.view.start - dt, this.downAt.view.end - dt);
    }
  };

  private hover(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    const p = this.local(e);
    const s = this.active;
    const near = s && p.y >= this.waveTop && Math.min(Math.abs(p.x - this.X(s.start)), Math.abs(p.x - this.X(s.end))) <= 10;
    this.c.style.cursor = near ? "ew-resize" : p.y < this.L.mini + 2 ? "pointer" : "default";
  }

  private up = (e: PointerEvent) => this.finish(e, false);
  private cancel = (e: PointerEvent) => this.finish(e, true);

  private finish(e: PointerEvent, cancelled: boolean) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.mode === "pinch") {
      this.mode = this.pointers.size ? "done" : null;
      return;
    }
    if (!cancelled && this.mode === "tap") {
      const t = clamp(this.T(p.x), 0, this.duration || Infinity);
      let hit: TLSeg | undefined;
      if (p.y >= this.lanesTop) {
        const lane = Math.floor((p.y - this.lanesTop) / (this.L.lane + this.L.gap));
        hit = this.segs.find((s) => this.lanes.indexOf(s.speaker) === lane && t >= s.start && t <= s.end);
      }
      hit ||= this.segs.find((s) => t >= s.start && t <= s.end);
      this.cb.onTap(t, hit?.id ?? null);
    }
    if ((this.mode === "start" || this.mode === "end") && this.activeId) {
      this.cb.onBoundary(this.activeId, this.mode, clamp(this.T(p.x), 0, this.duration || Infinity), true);
    }
    if (!this.pointers.size) this.mode = null;
  }

  private jump(x: number) {
    const t = clamp((x / this.W) * this.duration, 0, this.duration);
    this.setView(t - this.span / 2, t + this.span / 2);
  }

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      const d = ((e.shiftKey ? e.deltaY : e.deltaX) / this.W) * this.span;
      this.setView(this.view.start + d, this.view.end + d);
    } else this.zoom(Math.exp(e.deltaY * 0.0025), this.T(p.x));
  };

  // ---------------------------------------------------------------- drawing
  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paint();
    });
  }

  private rr(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  paint() {
    const { ctx, W, H, L } = this;
    if (!W || !H) return;
    const dark = isDark();
    const css = getComputedStyle(this.c);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const fg = v("--foreground"), muted = v("--muted-foreground"), line = v("--border"), primary = v("--primary"), ink = v("--ink"), inkFg = v("--ink-foreground"), card = v("--card"), sec = v("--secondary");
    ctx.clearRect(0, 0, W, H);
    const dur = this.duration || 1;

    // minimap
    ctx.fillStyle = sec;
    this.rr(0, 1, W, L.mini - 3, 3);
    ctx.fill();
    for (const s of this.segs) {
      ctx.fillStyle = speakerColor(s.speaker, this.lanes, dark).stroke;
      ctx.fillRect((s.start / dur) * W, 2, Math.max(1, ((s.end - s.start) / dur) * W), L.mini - 5);
    }
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.25;
    this.rr((this.view.start / dur) * W + 0.5, 0.5, Math.max(4, (this.span / dur) * W) - 1, L.mini - 1, 3);
    ctx.stroke();

    // ruler
    const pps = W / this.span;
    const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((s) => s * pps >= 70) || 3600;
    const minor = step / 5;
    ctx.font = "500 10px 'JetBrains Mono Variable', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    const ry = L.mini + L.ruler / 2 + 1;
    for (let t = Math.ceil(this.view.start / minor) * minor; t <= this.view.end; t += minor) {
      const x = Math.round(this.X(t)) + 0.5;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ctx.fillStyle = line;
      ctx.fillRect(x, major ? ry - 4 : ry - 2, 1, major ? 8 : 4);
      if (major) {
        ctx.fillStyle = muted;
        ctx.fillText(fmtTime(t, step < 1 ? 1 : 0), x + 4, ry);
      }
    }

    // lane rows
    for (let i = 0; i < this.lanes.length; i++) {
      ctx.fillStyle = line;
      ctx.fillRect(0, this.laneY(i) + L.lane + L.gap / 2 - 0.5, W, 1);
    }

    // waveform: rounded bars, orange inside the active segment
    const a = this.active;
    const wt = this.waveTop + 2, wb = this.waveTop + L.wave - 2, mid = (wt + wb) / 2, half = (wb - wt) / 2;
    if (this.peaks) {
      const { peaks, perSec } = this.peaks;
      const bw = W / this.span / perSec >= 3 ? Math.max(2, Math.floor(W / this.span / perSec) - 1) : 2;
      const stride = bw + 1;
      for (let x = 0; x < W; x += stride) {
        const t0 = this.T(x), t1 = this.T(x + stride);
        const i0 = Math.floor(t0 * perSec), i1 = Math.max(i0 + 1, Math.ceil(t1 * perSec));
        if (i1 <= 0 || i0 >= peaks.length) continue;
        let m = 0;
        for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > m) m = peaks[i];
        const h = Math.max(1, m * half);
        const inA = a && t0 >= a.start && t1 <= a.end;
        ctx.fillStyle = inA ? primary : muted;
        ctx.globalAlpha = inA ? 0.95 : 0.45;
        this.rr(x, mid - h, bw, h * 2, bw / 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = muted;
      ctx.fillText("Waveform not available for this format", 8, mid);
    }

    // blocks
    const rad = L.lane > 20 ? 8 : 3;
    for (const s of this.segs) {
      if (s.end < this.view.start || s.start > this.view.end) continue;
      const lane = Math.max(0, this.lanes.indexOf(s.speaker));
      const x0 = this.X(s.start), x1 = this.X(s.end), y = this.laneY(lane), w = Math.max(3, x1 - x0 - 1);
      const col = speakerColor(s.speaker, this.lanes, dark);
      const isA = s.id === this.activeId;
      ctx.globalAlpha = s.checked || isA ? 1 : 0.6;
      ctx.fillStyle = col.fill;
      this.rr(x0, y, w, L.lane, rad);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isA ? 2 : 1;
      ctx.strokeStyle = isA ? primary : col.stroke;
      this.rr(x0 + 0.5, y + 0.5, w - 1, L.lane - 1, rad);
      ctx.stroke();
      if (L.lane > 20 && w > 18) { // grips at both ends
        ctx.fillStyle = isA ? primary : card;
        ctx.globalAlpha = isA ? 1 : 0.9;
        const gh = L.lane - 12;
        this.rr(x0 + 4, y + 6, 3, gh, 1.5);
        ctx.fill();
        this.rr(x0 + w - 7, y + 6, 3, gh, 1.5);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // active boundaries
    if (a) {
      ctx.fillStyle = primary;
      for (const t of [a.start, a.end]) {
        const x = this.X(t);
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x - 0.5, this.waveTop, 1, H - this.waveTop);
        ctx.globalAlpha = 1;
        this.rr(x - 3, wb - 8, 6, 12, 3);
        ctx.fill();
      }
    }

    // playhead with a time badge
    if (this.t >= this.view.start && this.t <= this.view.end) {
      const x = Math.round(this.X(this.t));
      ctx.fillStyle = ink;
      ctx.fillRect(x - 0.75, L.mini + 4, 1.5, H - L.mini - 4);
      const label = fmtTime(this.t, 2);
      ctx.font = "600 10px 'JetBrains Mono Variable', ui-monospace, monospace";
      const tw = ctx.measureText(label).width + 10;
      const bx = clamp(x - tw / 2, 0, W - tw);
      this.rr(bx, L.mini + 2, tw, L.ruler - 4, 5);
      ctx.fill();
      ctx.fillStyle = inkFg;
      ctx.fillText(label, bx + 5, L.mini + L.ruler / 2);
    }
  }
}

/** Zoomed view of one segment: bar waveform, the region tinted, two tall handles (like a trimmer). */
export class SegmentWave {
  c: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  peaks: TLPeaks | null = null;
  duration = 0;
  seg: { id: string; start: number; end: number } | null = null;
  t = 0;
  view = { start: 0, end: 4 };
  private drag: "start" | "end" | null = null;
  private ro: ResizeObserver;
  onBoundary: (which: "start" | "end", t: number, done: boolean) => void = () => {};
  onSeek: (t: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  destroy() { this.ro.disconnect(); }

  set(peaks: TLPeaks | null, duration: number, seg: { id: string; start: number; end: number } | null) {
    const changed = seg?.id !== this.seg?.id;
    this.peaks = peaks;
    this.duration = duration;
    this.seg = seg;
    if (seg && (changed || !this.drag)) {
      const pad = Math.max(1, (seg.end - seg.start) * 0.35);
      if (changed || seg.start < this.view.start || seg.end > this.view.end) this.view = { start: Math.max(0, seg.start - pad), end: Math.min(duration || seg.end + pad, seg.end + pad) };
    }
    this.paint();
  }

  setTime(t: number) {
    this.t = t;
    this.paint();
  }

  get W() { return this.c.clientWidth; }
  get H() { return this.c.clientHeight; }
  X(t: number) { return ((t - this.view.start) / (this.view.end - this.view.start)) * this.W; }
  T(x: number) { return this.view.start + (x / this.W) * (this.view.end - this.view.start); }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.c.width = Math.round(this.W * dpr);
    this.c.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.paint();
  }

  private local(e: PointerEvent) {
    const r = this.c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    if (!this.seg) return;
    this.c.setPointerCapture(e.pointerId);
    const { x } = this.local(e);
    const ds = Math.abs(x - this.X(this.seg.start)), de = Math.abs(x - this.X(this.seg.end));
    if (Math.min(ds, de) < 28) this.drag = ds <= de ? "start" : "end";
    else this.onSeek(clamp(this.T(x), 0, this.duration));
  };

  private move = (e: PointerEvent) => {
    if (!this.drag) return;
    this.onBoundary(this.drag, clamp(this.T(this.local(e).x), 0, this.duration), false);
  };

  private up = (e: PointerEvent) => {
    if (!this.drag) return;
    const which = this.drag;
    this.drag = null;
    this.onBoundary(which, clamp(this.T(this.local(e).x), 0, this.duration), true);
  };

  paint() {
    const { ctx, W, H } = this;
    if (!W || !H) return;
    const css = getComputedStyle(this.c);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const primary = v("--primary"), muted = v("--muted-foreground"), ink = v("--ink"), card = v("--card");
    ctx.clearRect(0, 0, W, H);
    const s = this.seg;
    const top = 14, bot = H - 14, mid = (top + bot) / 2, half = (bot - top) / 2;
    if (s) {
      ctx.fillStyle = primary;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(this.X(s.start), top - 6, this.X(s.end) - this.X(s.start), bot - top + 12);
      ctx.globalAlpha = 1;
    }
    if (this.peaks) {
      const { peaks, perSec } = this.peaks;
      for (let x = 0; x < W; x += 4) {
        const t0 = this.T(x), t1 = this.T(x + 4);
        const i0 = Math.floor(t0 * perSec), i1 = Math.max(i0 + 1, Math.ceil(t1 * perSec));
        let m = 0;
        for (let i = Math.max(0, i0); i < Math.min(peaks.length, i1); i++) if (peaks[i] > m) m = peaks[i];
        const h = Math.max(1.5, m * half);
        const inside = s && t0 >= s.start && t1 <= s.end;
        ctx.fillStyle = inside ? primary : muted;
        ctx.globalAlpha = inside ? 1 : 0.35;
        ctx.beginPath();
        ctx.roundRect(x, mid - h, 2.5, h * 2, 1.25);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (s) {
      for (const t of [s.start, s.end]) {
        const x = this.X(t);
        ctx.fillStyle = ink;
        ctx.fillRect(x - 1, 8, 2, H - 16);
        for (const y of [8, H - 8]) {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = card;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = ink;
        }
      }
    }
    if (this.t >= this.view.start && this.t <= this.view.end) {
      ctx.fillStyle = primary;
      ctx.fillRect(this.X(this.t) - 0.75, 4, 1.5, H - 8);
    }
  }
}
