// The open file: segments, selection, undo/redo, playback commands and saving.
// Saving: to this device at once, to Drive after a 6 s pause (at least once a minute). A random
// saveid per save tells us if someone else (or another device) saved in between.
import { create } from "zustand";
import { toast } from "sonner";
import { uid, clamp, fmtAgo, debounce } from "@/lib/util.js";
import { annotatorTag, outputName } from "@/lib/project.js";
import {
  parseTranscript, newDoc, sortSegments, speakerList, docProperties, checkDoc, hasFlags, BACKGROUND, UNSURE, SCHEMA,
} from "@/lib/formats.js";
import { prepareAudio } from "@/lib/audio.js";
import { player } from "@/editor/player";
import { ask, confirm, prompt } from "./dialogs";
import { useSession, loadProject, loadOverview } from "./session";
import type { DataSet, Doc, Item, Peaks, Seg, StartPlan, Status } from "@/editor/types";

export type Filter = "all" | "unchecked" | "flagged";
interface Snap { segs: Seg[]; speakers: Doc["speakers"]; activeId: string | null }

export interface EditorState {
  item: Item | null;
  set: DataSet | null;
  doc: Doc | null;
  audioUrl: string;
  peaks: Peaks | null;
  duration: number;
  owner: string;
  ownerName: string;
  mode: "own" | "review";
  outputFileId: string | null;
  saveid: string | null;
  outputName: string;
  segs: Seg[];
  activeId: string | null;
  filter: Filter;
  rev: number;
  savedRev: number;
  timeDirty: boolean;
  saving: boolean;
  saveError: string | null;
  lastSaved: string | null;
  past: Snap[];
  future: Snap[];
  loop: boolean;
  scrollTick: number; // bumps when the active row should scroll into view
  focusTick: number; // bumps when the active row's text box should take focus
  panel: null | "sheet" | "checks" | "speakers" | "keys" | "restart";
}

const EMPTY: EditorState = {
  item: null, set: null, doc: null, audioUrl: "", peaks: null, duration: 0, owner: "", ownerName: "", mode: "own",
  outputFileId: null, saveid: null, outputName: "", segs: [], activeId: null, filter: "all", rev: 0, savedRev: 0,
  timeDirty: false, saving: false, saveError: null, lastSaved: null, past: [], future: [], loop: false,
  scrollTick: 0, focusTick: 0, panel: null,
};

export const useEditor = create<EditorState>(() => ({ ...EMPTY }));
const S = useEditor.getState;
const put = useEditor.setState;
const sess = useSession.getState;
const coarse = () => matchMedia("(pointer: coarse)").matches;
const pref = (k: string, d: string) => localStorage.getItem("aimscribe:" + k) ?? d;

export const activeSeg = (s: EditorState = S()) => s.segs.find((x) => x.id === s.activeId);
export const speakersOf = (s: EditorState = S()): string[] => speakerList(s.segs, s.doc?.speakers || {});
export const visibleSegs = (segs: Seg[], filter: Filter) =>
  segs.filter((s) => filter === "all" || (filter === "unchecked" && !s.checked) || (filter === "flagged" && hasFlags(s)));

// ---------------------------------------------------------------- changes and undo

let lastKey: string | null = null, lastAt = 0;

/** Apply a change. Undoable changes push a snapshot; typing in one segment is grouped. */
function commit(next: Partial<EditorState>, key: string | null = null) {
  const s = S();
  const now = Date.now();
  const grouped = key && key === lastKey && now - lastAt < 1500;
  lastKey = key;
  lastAt = now;
  const past = grouped ? s.past : [...s.past, { segs: s.segs, speakers: s.doc!.speakers, activeId: s.activeId }].slice(-200);
  put({ ...next, past, future: [], rev: s.rev + 1, doc: { ...(next.doc || s.doc!), updated: new Date().toISOString() } });
  afterChange();
}

function afterChange() {
  saveLocalSoon();
  scheduleRemote();
}

export function undo() {
  const s = S();
  const p = s.past[s.past.length - 1];
  if (!p) return toast("Nothing to undo");
  put({ past: s.past.slice(0, -1), future: [{ segs: s.segs, speakers: s.doc!.speakers, activeId: s.activeId }, ...s.future],
    segs: p.segs, activeId: p.activeId, doc: { ...s.doc!, speakers: p.speakers }, rev: s.rev + 1 });
  lastKey = null;
  afterChange();
}

export function redo() {
  const s = S();
  const f = s.future[0];
  if (!f) return toast("Nothing to redo");
  put({ future: s.future.slice(1), past: [...s.past, { segs: s.segs, speakers: s.doc!.speakers, activeId: s.activeId }],
    segs: f.segs, activeId: f.activeId, doc: { ...s.doc!, speakers: f.speakers }, rev: s.rev + 1 });
  lastKey = null;
  afterChange();
}

const mapSeg = (id: string, f: (s: Seg) => Seg) => S().segs.map((s) => (s.id === id ? f(s) : s));
const r2 = (t: number) => Math.round(t * 100) / 100;

export function setText(id: string, text: string) {
  commit({ segs: mapSeg(id, (s) => ({ ...s, text })) }, `text:${id}`);
}
export function toggleChecked(id: string) {
  commit({ segs: mapSeg(id, (s) => ({ ...s, checked: !s.checked })) });
}
export function toggleOverlap(id: string) {
  commit({ segs: mapSeg(id, (s) => ({ ...s, overlap: !s.overlap })) });
}
export function setSpeaker(id: string, speaker: string) {
  const s = S();
  const speakers = { ...s.doc!.speakers };
  if (speaker !== BACKGROUND && speaker !== UNSURE && !speakers[speaker]) speakers[speaker] = { role: "" };
  commit({ segs: mapSeg(id, (x) => ({ ...x, speaker })), doc: { ...s.doc!, speakers } });
}

export function setActive(id: string | null, opts: { scroll?: boolean; play?: boolean; focus?: boolean } = {}) {
  const s = S();
  put({ activeId: id, scrollTick: s.scrollTick + (opts.scroll ? 1 : 0), focusTick: s.focusTick + (opts.focus ? 1 : 0) });
  lastKey = null;
  const a = activeSeg();
  if (opts.play && a) playSeg(a);
}

// Dragging a boundary: live updates without undo entries, one entry when the drag ends.
let dragFrom: Snap | null = null;
export function moveBoundary(id: string, which: "start" | "end", t: number, done: boolean, preview = true) {
  const s = S();
  if (!dragFrom) dragFrom = { segs: s.segs, speakers: s.doc!.speakers, activeId: s.activeId };
  t = r2(clamp(t, 0, s.duration));
  const segs = mapSeg(id, (x) => (which === "start" ? { ...x, start: Math.min(t, x.end - 0.05) } : { ...x, end: Math.max(t, x.start + 0.05) }));
  if (!done) return put({ segs });
  const from = dragFrom;
  dragFrom = null;
  put({ segs: from.segs });
  commit({ segs: sortSegments([...segs]) });
  const seg = S().segs.find((x) => x.id === id);
  if (preview && seg) previewEdge(seg, which);
}

/** After a boundary moves, play 1.5 s at that edge so a clipped word is heard at once. */
function previewEdge(s: Seg, which: "start" | "end") {
  if (which === "start") player.playRange(s.start, Math.min(s.end, s.start + 1.5));
  else player.playRange(Math.max(s.start, s.end - 1.5), s.end);
}

export function nudge(which: "start" | "end", d: number) {
  const a = activeSeg();
  if (a) moveBoundary(a.id, which, a[which] + d, true);
}
export function boundaryHere(which: "start" | "end") {
  const a = activeSeg();
  if (a) moveBoundary(a.id, which, player.time, true, false);
}

/** Split at the playhead (or the middle); the text splits at `caret`, else in proportion to time. */
export function split(caret: number | null = null) {
  const s = S(), a = activeSeg();
  if (!a) return;
  let t = player.time;
  if (!(t > a.start + 0.05 && t < a.end - 0.05)) {
    t = (a.start + a.end) / 2;
    toast("Playhead was outside the segment, so it was split in the middle");
  }
  const text = a.text || "";
  let at = caret;
  if (at == null) {
    const want = Math.round(text.length * ((t - a.start) / (a.end - a.start)));
    const spaces = [...text.matchAll(/\s/g)].map((m) => m.index!);
    at = spaces.length ? spaces.reduce((x, y) => (Math.abs(y - want) < Math.abs(x - want) ? y : x)) : text.length;
  }
  const right: Seg = { id: uid(), start: r2(t), end: a.end, speaker: a.speaker, overlap: a.overlap, checked: false, text: text.slice(at).trim(), draft: "" };
  const left: Seg = { ...a, end: right.start, text: text.slice(0, at).trim(), checked: false };
  commit({ segs: sortSegments(s.segs.map((x) => (x.id === a.id ? left : x)).concat(right)), filter: "all" });
}

export function mergeNext() {
  const s = S(), a = activeSeg();
  if (!a) return;
  const i = s.segs.indexOf(a), n = s.segs[i + 1];
  if (!n) return toast("This is the last segment");
  const merged: Seg = { ...a, end: Math.max(a.end, n.end), text: [a.text, n.text].filter(Boolean).join(" "),
    draft: [a.draft, n.draft].filter(Boolean).join(" "), overlap: a.overlap || n.overlap, checked: false };
  commit({ segs: s.segs.filter((x) => x !== n).map((x) => (x === a ? merged : x)) });
}

export function addAtPlayhead() {
  const s = S();
  const t = r2(player.time);
  const seg: Seg = { id: uid(), start: t, end: r2(Math.min(s.duration, t + 2)), speaker: activeSeg()?.speaker || "S1", text: "", overlap: false, checked: false, draft: "" };
  commit({ segs: sortSegments([...s.segs, seg]), activeId: seg.id, filter: "all", scrollTick: s.scrollTick + 1, focusTick: s.focusTick + (coarse() ? 0 : 1) });
}

export async function removeActive() {
  const s = S(), a = activeSeg();
  if (!a) return;
  if (a.text.trim() && !(await confirm("Delete segment?", `“${a.text.slice(0, 80)}”`, "Delete", "Cancel", true))) return;
  const i = s.segs.indexOf(a);
  const segs = s.segs.filter((x) => x !== a);
  commit({ segs, activeId: (segs[i] || segs[i - 1])?.id || null });
}

export function setRole(speaker: string, role: string) {
  const d = S().doc!;
  commit({ doc: { ...d, speakers: { ...d.speakers, [speaker]: { role } } } });
}

export function mergeSpeaker(from: string, into: string) {
  const s = S();
  const speakers = { ...s.doc!.speakers };
  delete speakers[from];
  commit({ segs: s.segs.map((x) => (x.speaker === from ? { ...x, speaker: into } : x)), doc: { ...s.doc!, speakers } });
}

export function renumberSpeakers() {
  const s = S();
  const order = speakerList(s.segs).filter((x: string) => x !== BACKGROUND && x !== UNSURE);
  const map: Record<string, string> = Object.fromEntries(order.map((x: string, i: number) => [x, `S${i + 1}`]));
  const speakers: Doc["speakers"] = {};
  for (const [a, b] of Object.entries(map)) speakers[b] = s.doc!.speakers[a] || { role: "" };
  commit({ segs: s.segs.map((x) => (map[x.speaker] ? { ...x, speaker: map[x.speaker] } : x)), doc: { ...s.doc!, speakers } });
  toast.success("Speakers renumbered by first speech");
}

export function setNotes(notes: string) {
  commit({ doc: { ...S().doc!, notes } }, "notes");
}

export function setFilter(filter: Filter) {
  put({ filter });
}

// ---------------------------------------------------------------- moving and playing

export function playSeg(s: Seg, from?: number) {
  player.playRange(from ?? s.start, s.end, S().loop, s.start);
}

let freePlay = false; // after a tap outside the active segment, play runs on
export function togglePlay() {
  if (player.playing) return player.pause();
  const a = activeSeg();
  const t = player.time;
  if (a && t >= a.start && t < a.end - 0.05) return playSeg(a, t);
  if (!a || freePlay) { freePlay = false; return player.playOn(); }
  playSeg(a);
}

export function replay() {
  const a = activeSeg();
  if (a) playSeg(a);
}

export function tapTimeline(t: number, segId: string | null) {
  const a = activeSeg();
  if (segId && (!a || t < a.start || t > a.end)) setActive(segId, { scroll: true });
  player.seek(t);
  const b = activeSeg();
  freePlay = !b || t < b.start || t >= b.end;
}

export function setLoop(on: boolean) {
  put({ loop: on });
  const a = activeSeg();
  if (a) player.setLoop(on, a.start);
}

export function step(dir: 1 | -1, play = true) {
  const s = S();
  const vis = visibleSegs(s.segs, s.filter);
  if (!vis.length) return;
  let i = vis.findIndex((x) => x.id === s.activeId);
  if (i < 0) {
    const a = activeSeg();
    let after = a ? vis.findIndex((x) => x.start > a.start) : 0;
    if (after < 0) after = vis.length;
    i = dir > 0 ? after - 1 : after;
  }
  const j = clamp(i + dir, 0, vis.length - 1);
  if (j === i) return toast(dir > 0 ? "That was the last segment" : "This is the first segment");
  setActive(vis[j].id, { scroll: true, focus: !coarse(), play: play && pref("autoplay", "1") === "1" });
}

export function checkAndNext() {
  const a = activeSeg();
  if (!a) return;
  if (!a.checked) commit({ segs: mapSeg(a.id, (x) => ({ ...x, checked: true })) });
  step(1);
}

// ---------------------------------------------------------------- status

export async function markDone() {
  const s = S();
  const errs = checkDoc({ segments: s.segs }).filter((x: { level: string }) => x.level === "error");
  const unticked = s.segs.filter((x) => !x.checked).length;
  if (errs.length || unticked) {
    const parts = [errs.length ? `${errs.length} problem${errs.length > 1 ? "s" : ""} found by the checks` : "", unticked ? `${unticked} segment${unticked > 1 ? "s" : ""} not ticked` : ""].filter(Boolean);
    if (!(await confirm("Not finished yet?", `${parts.join(" and ")}. Mark as done anyway?`, "Mark as done", "Keep working"))) return;
  }
  commit({ doc: { ...S().doc!, status: "done" } });
  await saveRemote(true).catch(() => {});
  toast.success("Marked as done", { description: "A reviewer can now accept it." });
}

export function reopen() {
  commit({ doc: { ...S().doc!, status: "in_progress" } });
  saveRemote(true).catch(() => {});
}

export async function review(status: Extract<Status, "reviewed" | "returned">) {
  const note = status === "returned"
    ? await prompt("Return to annotator", "What should they fix? They see this note when they open the file.", "", { multiline: true, ok: "Return" })
    : await prompt("Accept annotation", "Note for the annotator (optional)", "", { multiline: true, ok: "Accept" });
  if (note == null) return;
  const u = sess().user!;
  commit({ doc: { ...S().doc!, status, review: { by: u.email, name: u.name, at: new Date().toISOString(), note } } });
  await saveRemote(true).catch(() => {});
  toast.success(status === "reviewed" ? "Accepted" : "Returned with your note");
}

// ---------------------------------------------------------------- opening

export function openItem(item: Item) {
  const me = sess().user!.email;
  const access = item.access || { annotate: true, review: true };
  const own = item.outputs.find((o) => o.annotator === me);
  const others = item.outputs.filter((o) => o !== own);
  if (!access.annotate && !own) { // reviewer only
    if (!others.length) return toast("Nothing to review yet", { description: "The annotator has not saved this file." });
    if (others.length === 1) return startEditor(item, { kind: "review", output: others[0] });
    return useSession.setState({ openFor: item });
  }
  if (!item.outputs.length) {
    if (!item.sources.length) toast("No draft found for this file: starting blank");
    return startEditor(item, { kind: "new", source: item.sources[0] || null });
  }
  if (own && !others.length) return startEditor(item, { kind: "own", output: own });
  useSession.setState({ openFor: item });
}

const LOCAL = "aimscribe:local:";
const localKey = (s: EditorState = S()) => `${LOCAL}${sess().store!.kind}:${sess().user!.email}|${s.owner}|${s.item!.setId}|${s.item!.base}`;

export async function startEditor(item: Item, plan: StartPlan) {
  const { store, user, project } = sess();
  if (!store || !user || !project) return;
  const set = project.sets.find((s) => s.id === item.setId)!;
  const loading = (text: string, progress: number | null = null) => useSession.setState({ loading: { text, progress } });
  loading(`Opening ${item.base}`, 0);
  try {
    const textId = plan.kind === "new" ? (plan.from || plan.source?.fileId) : plan.output.fileId;
    const [buf, text] = await Promise.all([
      store.getAudio(item.audio.fileId, item.audio.size, (p) => loading(`Downloading ${item.base}`, p)),
      textId && !(plan.kind === "new" && plan.blank) ? store.getText(textId) : Promise.resolve(null),
    ]);
    loading("Drawing the waveform");
    const audio = await prepareAudio(buf, item.audio.mimeType);
    const duration: number = audio.peaks?.duration || (await mediaDuration(audio.url));
    let doc: Doc, owner = user.email, ownerName = user.name;
    if (plan.kind !== "new") {
      doc = JSON.parse(text!);
      if (doc.schema !== SCHEMA) throw new Error("This file was not written by the annotator");
      owner = doc.annotator?.email || plan.output.annotator;
      ownerName = doc.annotator?.name || plan.output.annotatorName;
    } else {
      let segs: Omit<Seg, "id">[] = [], speakers: Doc["speakers"] = {}, label = "blank";
      if (text) {
        const parsed = parseTranscript(text, plan.source?.name || "x.json");
        if (parsed.doc) {
          segs = parsed.doc.segments.map((x: Seg) => ({ ...x, draft: x.draft || x.text }));
          speakers = parsed.doc.speakers || {};
          label = `annotation by ${parsed.doc.annotator?.name || "a teammate"}`;
        } else {
          segs = parsed.segments;
          speakers = parsed.speakers || {};
          label = plan.source?.label || "draft";
        }
      }
      doc = newDoc({ audio: { base: item.base, name: item.audio.name, fileId: item.audio.fileId }, sourceLabel: label, segments: segs,
        speakers, user, mode: plan.blank ? "blank" : plan.timing ? "timing" : "draft" }) as Doc;
    }
    doc.duration = duration;
    const segs: Seg[] = doc.segments.map((x) => {
      const end = x.end == null || x.end > duration ? r2(duration) : x.end;
      return { ...x, end, start: Math.min(x.start, Math.max(0, end - 0.5)), id: uid() } as Seg;
    });
    const out = plan.kind !== "new" ? plan.output : null;
    let saveid = out?.saveid || null;
    if (out) { // the listing may be old: compare later saves with the real latest
      try { saveid = (await store.getProps(out.fileId)).properties.saveid || saveid; } catch { /* keep listing value */ }
    }
    const first = segs.find((x) => !x.checked) || segs[0];
    put({
      ...EMPTY, item, set, doc, audioUrl: audio.url, peaks: audio.peaks, duration, owner, ownerName,
      mode: plan.kind === "review" ? "review" : "own",
      outputFileId: out?.fileId || null, saveid, outputName: out?.name || outputName(item.base, uniqueTag(item)),
      segs, activeId: first?.id || null, scrollTick: 1,
    });
    useSession.setState({ loading: null });
    await offerLocalCopy();
    player.load(audio.url);
    if (first) player.seek(first.start);
    useSession.setState({ screen: "editor" });
    history.pushState({ editor: 1 }, "");
    if (S().rev !== S().savedRev) scheduleRemote();
  } catch (e) {
    console.error(e);
    useSession.setState({ loading: null });
    toast.error(`Could not open ${item.base}`, { description: (e as Error).message });
  }
}

function mediaDuration(url: string): Promise<number> {
  return new Promise((res) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => res(a.duration);
    a.onerror = () => res(0);
    a.src = url;
  });
}

/** My output file name; a short hash is added if a teammate has the same email name. */
function uniqueTag(item: Item) {
  const email = sess().user!.email;
  let tag: string = annotatorTag(email);
  if (item.outputs.some((o) => o.tag === tag && o.annotator && o.annotator !== email)) {
    let x = 0;
    for (const c of email) x = (x * 31 + c.charCodeAt(0)) >>> 0;
    tag += "-" + x.toString(36).slice(0, 4);
  }
  return tag;
}

async function offerLocalCopy() {
  let saved: { at: string; baseSaveid: string | null; outputFileId: string | null; doc: Doc } | null = null;
  try { saved = JSON.parse(localStorage.getItem(localKey()) || "null"); } catch { saved = null; }
  if (!saved?.doc) return;
  const s = S();
  const same = (saved.baseSaveid || null) === (s.saveid || null);
  const choice = await ask("Unsaved changes on this device",
    same ? `Changes from ${fmtAgo(saved.at)} never reached Drive. Restore them?`
      : `This device has changes from ${fmtAgo(saved.at)} that never reached Drive, and the Drive copy has changed since. Which version do you want?`,
    [{ label: same ? "Discard" : "Use the Drive version", value: "drive", variant: "ghost" }, { label: same ? "Restore" : "Use this device's version", value: "local", variant: "ink" }],
    "local"); // closing the dialog keeps the device copy: never lose work by accident
  if (choice === "drive") return localStorage.removeItem(localKey());
  const segs = saved.doc.segments.map((x) => ({ ...x, id: uid() }) as Seg);
  let saveid = s.saveid;
  const outputFileId = s.outputFileId || saved.outputFileId || null;
  if (!same && outputFileId) saveid = (await sess().store!.getProps(outputFileId).catch(() => null))?.properties?.saveid || saveid;
  put({ doc: saved.doc, segs, activeId: (segs.find((x) => !x.checked) || segs[0])?.id || null, outputFileId, saveid, rev: 1 });
}

// ---------------------------------------------------------------- saving

function buildDoc(): Doc {
  const s = S();
  const segments = s.segs.map(({ id: _id, ...x }) => ({ ...x, text: (x.text || "").replace(/\s+/g, " ").trim() }));
  const present = new Set(segments.map((x) => x.speaker));
  const speakers: Doc["speakers"] = {};
  for (const k of present) if (k !== BACKGROUND && k !== UNSURE) speakers[k] = s.doc!.speakers[k] || { role: "" };
  return { ...s.doc!, speakers, segments };
}

let warnedFull = false;
function saveLocal() {
  const s = S();
  if (!s.doc || s.rev === s.savedRev) return;
  try {
    localStorage.setItem(localKey(), JSON.stringify({ at: new Date().toISOString(), setId: s.item!.setId, base: s.item!.base, baseSaveid: s.saveid, outputFileId: s.outputFileId, doc: buildDoc() }));
  } catch {
    if (!warnedFull) toast.warning("This device's storage is full", { description: "Changes are safe only once saved to Drive." });
    warnedFull = true;
  }
}
const saveLocalSoon = debounce(saveLocal, 700);

let timer: ReturnType<typeof setTimeout> | undefined, firstUnsynced = 0, inflight: Promise<void> | null = null, again = false;
function scheduleRemote() {
  clearTimeout(timer);
  if (!firstUnsynced) firstUnsynced = Date.now();
  timer = setTimeout(() => saveRemote().catch(() => {}), Date.now() - firstUnsynced > 60e3 ? 0 : 6000);
}

export function saveRemote(force = false): Promise<void> {
  const s = S();
  if (!s.doc) return Promise.resolve();
  if (inflight) { again = true; return inflight; }
  if (s.rev === s.savedRev && !s.timeDirty && !force) return Promise.resolve();
  clearTimeout(timer);
  const rev = s.rev;
  const store = sess().store!;
  put({ saving: true });
  inflight = (async () => {
    try {
      let { outputFileId } = S();
      const doc = buildDoc();
      if (outputFileId) {
        const remote = await store.getProps(outputFileId).catch((e: { status?: number }) => (e.status === 404 ? null : Promise.reject(e)));
        if (!remote || remote.trashed) outputFileId = null;
        else if ((remote.properties.saveid || null) !== (S().saveid || null)) {
          const choice = await ask("Saved somewhere else",
            `${remote.lastBy || "Someone"} saved this annotation ${fmtAgo(remote.modifiedTime)}, after you opened it (another device, or a reviewer). Keep which version?`,
            [{ label: "Cancel", value: "cancel", variant: "ghost" }, { label: "Load theirs", value: "theirs", variant: "outline" }, { label: "Keep mine", value: "mine", variant: "ink" }], "cancel");
          if (choice === "theirs") {
            const { item, mode } = S();
            const fileId = outputFileId;
            localStorage.removeItem(localKey());
            put({ savedRev: S().rev });
            setTimeout(async () => {
              await closeEditor(true);
              const out = item!.outputs.find((o) => o.fileId === fileId);
              if (out) startEditor(item!, { kind: mode, output: out });
            });
            return;
          }
          if (choice !== "mine") throw new Error("Not saved: a newer copy is on Drive");
        }
      }
      doc.updated = new Date().toISOString();
      const saveid: string = uid();
      const props = docProperties(doc, saveid);
      const content = JSON.stringify(doc, null, 1);
      if (!outputFileId) {
        const folder = await store.ensureOutputFolder(S().set!);
        const existing = await store.findByName(folder, S().outputName);
        if (existing && (existing.properties?.saveid || null) !== (S().saveid || null)
          && !(await confirm("File already on Drive", `${S().outputName} already exists (saved from another device?). Overwrite it with this version?`, "Overwrite"))) {
          throw new Error("Not saved");
        }
        outputFileId = (existing ? await store.updateJson(existing.id, content, props) : await store.createJson(folder, S().outputName, content, props)).id;
      } else await store.updateJson(outputFileId, content, props);
      const done = S().rev === rev;
      put({ outputFileId, saveid, timeDirty: false, lastSaved: doc.updated, saveError: null, ...(done ? { savedRev: rev } : {}) });
      if (done) {
        firstUnsynced = 0;
        localStorage.removeItem(localKey());
      }
    } catch (e) {
      console.error(e);
      put({ saveError: (e as Error).message });
      saveLocal();
      if (force) toast.error("Not saved to Drive", { description: `${(e as Error).message}. Your changes are kept on this device.` });
      throw e;
    } finally {
      inflight = null;
      put({ saving: false });
      if (again && S().doc) { again = false; scheduleRemote(); }
    }
  })();
  return inflight;
}

export async function closeEditor(skipSave = false) {
  const s = S();
  if (!s.doc) return;
  player.pause();
  if (!skipSave && (s.rev !== s.savedRev || s.timeDirty)) {
    useSession.setState({ loading: { text: "Saving", progress: null } });
    try { await saveRemote(true); } catch { toast.warning("Kept on this device only", { description: "Open the file again when you're online to upload it." }); }
    useSession.setState({ loading: null });
  }
  clearTimeout(timer);
  firstUnsynced = 0;
  player.unload();
  URL.revokeObjectURL(s.audioUrl);
  put({ ...EMPTY });
  const back = sess().returnTo;
  useSession.setState({ screen: back });
  if (history.state?.editor) history.back();
  if (back === "admin") loadOverview();
  else loadProject(true);
}

/** "Start again from another draft": keeps my output file so no second copy appears. */
export async function restart(plan: StartPlan) {
  const s = S();
  const keep = { outputFileId: s.outputFileId, saveid: s.saveid, outputName: s.outputName };
  const item = s.item!;
  await closeEditor(true);
  await startEditor({ ...item, outputs: item.outputs.filter((o) => o.annotator !== sess().user!.email) }, plan);
  if (S().doc && keep.outputFileId) {
    put({ ...keep, rev: S().rev + 1 });
    scheduleRemote();
  }
}

// Changes kept only on this device, for the banner on the file list.
export function pendingLocal() {
  const { store, user } = sess();
  if (!store || !user) return [];
  const prefix = `${LOCAL}${store.kind}:${user.email}|`;
  return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => {
    try { return JSON.parse(localStorage.getItem(k)!) as { at: string; setId: string; base: string }; } catch { return null; }
  }).filter(Boolean) as { at: string; setId: string; base: string }[];
}

// ---------------------------------------------------------------- page lifecycle

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => { if (S().doc && sess().screen === "editor") closeEditor(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && S().doc) { saveLocal(); saveRemote().catch(() => {}); }
  });
  window.addEventListener("beforeunload", (e) => {
    const s = S();
    if (s.doc && s.rev !== s.savedRev) { saveLocal(); e.preventDefault(); }
  });
  let lastActivity = Date.now();
  for (const ev of ["pointerdown", "keydown", "input"]) document.addEventListener(ev, () => { lastActivity = Date.now(); }, true);
  // Time worked: while the file is open, visible, and touched in the last minute (or playing).
  setInterval(() => {
    const s = S();
    if (!s.doc || document.visibilityState !== "visible") return;
    if (Date.now() - lastActivity > 60e3 && !player.playing) return;
    const key = s.mode === "own" ? "time_spent_sec" : "review_time_sec";
    put({ doc: { ...s.doc, [key]: (s.doc[key] || 0) + 5 }, timeDirty: true });
  }, 5000);
}
