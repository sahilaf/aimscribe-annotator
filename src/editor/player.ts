// One <audio> element for the whole app, plus "play this range and stop" and a time feed for the
// canvases. Time is pushed to subscribers every frame while playing, without React re-renders.
import { useSyncExternalStore, useEffect, useState } from "react";

const el = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
if (el) el.preload = "auto";

let stopAt: number | null = null;
let loopFrom: number | null = null;
let raf = 0;
const timeSubs = new Set<(t: number) => void>();
const stateSubs = new Set<() => void>();

function emit() {
  const t = el.currentTime;
  for (const f of timeSubs) f(t);
}

/** Stop or loop at the end of the range. Runs per frame, and on timeupdate when frames are throttled. */
function checkStop() {
  if (el.paused || stopAt == null || el.currentTime < stopAt) return;
  if (loopFrom != null) el.currentTime = loopFrom;
  else {
    el.pause();
    stopAt = null;
  }
}

function frame() {
  checkStop();
  emit();
  raf = el.paused ? 0 : requestAnimationFrame(frame);
}

if (el) {
  el.addEventListener("play", () => {
    if (!raf) raf = requestAnimationFrame(frame);
    stateSubs.forEach((f) => f());
  });
  el.addEventListener("pause", () => {
    emit();
    stateSubs.forEach((f) => f());
  });
  el.addEventListener("timeupdate", checkStop);
  el.addEventListener("seeked", emit);
  el.addEventListener("ratechange", () => stateSubs.forEach((f) => f()));
}

export const player = {
  el,
  get time() { return el.currentTime; },
  get playing() { return !el.paused; },
  load(url: string) {
    el.src = url;
    el.playbackRate = Number(localStorage.getItem("aimscribe:rate") || 1);
    stopAt = loopFrom = null;
  },
  unload() {
    el.pause();
    el.removeAttribute("src");
    el.load();
  },
  /** Play [from, to) and stop; with loop, start again at `loopStart`. */
  playRange(from: number, to: number, loop = false, loopStart = from) {
    el.currentTime = from;
    stopAt = to;
    loopFrom = loop ? loopStart : null;
    return el.play().catch(() => {});
  },
  playOn() {
    stopAt = loopFrom = null;
    return el.play().catch(() => {});
  },
  pause() { el.pause(); },
  seek(t: number) {
    el.currentTime = Math.max(0, t);
    stopAt = null;
    emit();
  },
  seekBy(d: number) { this.seek(el.currentTime + d); },
  setLoop(on: boolean, start: number) { loopFrom = on && stopAt != null ? start : null; },
  get stopAt() { return stopAt; },
  setRate(r: number) {
    el.playbackRate = r;
    localStorage.setItem("aimscribe:rate", String(r));
  },
  onTime(f: (t: number) => void) {
    timeSubs.add(f);
    return () => { timeSubs.delete(f); };
  },
};

const subscribeState = (f: () => void) => { stateSubs.add(f); return () => { stateSubs.delete(f); }; };

export const usePlaying = () => useSyncExternalStore(subscribeState, () => !el.paused);
export const useRate = () => useSyncExternalStore(subscribeState, () => el.playbackRate);

/** Current time for text displays, at most `fps` updates a second. */
export function useTime(fps = 12) {
  const [t, setT] = useState(() => el?.currentTime || 0);
  useEffect(() => {
    let last = 0;
    return player.onTime((x) => {
      const now = performance.now();
      if (now - last > 1000 / fps || el.paused) {
        last = now;
        setT(x);
      }
    });
  }, [fps]);
  return t;
}
