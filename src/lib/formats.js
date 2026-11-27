// Reading drafts, writing the annotation file, rendering draft marks, and the automatic checks.
// Pure functions (no DOM, no Drive), tested in tests/run.mjs.
import { esc } from "./util.js";

export const SCHEMA = "aimscribe-annotation/1";
export const BACKGROUND = "পটভূমি"; // background voice: speaker label, no text (docs/02)
export const UNSURE = "?"; // speaker not yet assigned (pre-clean's missed-speech segments)
export const ROLES = ["ডাক্তার", "রোগী", "সঙ্গী", "অন্যান্য"];
export const MISSED = "[missed speech?]";

const FONT_TAG = /<\/?font\b[^>]*>/gi;
const HAS_FONT = /<font\b/i;
export const stripMarks = (s) => String(s ?? "").replace(FONT_TAG, "");

// Pre-clean colours (scripts/annotation/preclean_drafts.py)
const MARK_CLASS = { "#ff4d4d": "mk-red", "#3399ff": "mk-blue", "#ff9900": "mk-orange", "#d4a017": "mk-gold" };
const LOW_LOGPROB = -1.0; // same default as preclean_drafts.py --min_logprob

const num = (x) => (x == null || x === "" || isNaN(+x) ? null : +x);
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function normSpeaker(s) {
  if (s == null || s === "") return "S1";
  s = String(s).trim();
  const m = s.match(/^(?:speaker|spk)[ _-]?(\d+)$/i); // speaker_0 -> S1
  if (m) return `S${+m[1] + 1}`;
  return s;
}

/** Scribe turn with per-word logprob -> text with red marks on words Scribe was unsure of. */
function markFromWords(words) {
  if (!Array.isArray(words) || !words.some((w) => w.logprob != null && w.logprob < LOW_LOGPROB)) return null;
  let out = "";
  for (const w of words) {
    const t = w.text ?? "";
    if (w.type === "spacing") out += t;
    else if (w.type === "audio_event") out += /^[[(]/.test(t) ? t : `[${t}]`;
    else if (w.logprob != null && w.logprob < LOW_LOGPROB) out += `<font color="#ff4d4d">${t}</font>`;
    else out += t;
  }
  return out.replace(/\s+/g, " ").trim();
}

function fromRecord(r) {
  const raw = String(r.text ?? r.transcript ?? r.sentence ?? r.content ?? "");
  const marked = (!HAS_FONT.test(raw) && markFromWords(r.words)) || raw;
  return {
    start: round2(num(r.start ?? r.start_time ?? r.begin ?? r.from)),
    end: round2(num(r.end ?? r.end_time ?? r.stop ?? r.to)),
    speaker: normSpeaker(r.speaker ?? r.speaker_id ?? r.spk),
    text: stripMarks(marked).replace(/\s+/g, " ").trim(),
    overlap: !!r.overlap,
    draft: marked.trim(),
  };
}

const TIME = /(?:(\d+):)?(\d+):(\d+(?:[.,]\d+)?)/;
function secs(t) {
  const m = String(t).trim().match(TIME);
  if (!m) return null;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3].replace(",", ".");
}

// "[S1] [overlap] text": first bracket is a speaker only if it looks like one, so a line that
// starts with [অস্পষ্ট] keeps its tag.
const SPEAKER_LIKE = /^(S\d+|spk_?\d+|speaker[ _-]?\d+|\?|পটভূমি|ডাক্তার|রোগী|সঙ্গী|অন্যান্য|[A-Za-z][A-Za-z .-]{0,20}\d*)$/i;
function splitHead(text) {
  let speaker = null, overlap = false;
  let m = text.match(/^\s*\[([^\]]+)\]\s*/);
  if (m && SPEAKER_LIKE.test(m[1].trim()) && !/missed speech/i.test(m[1])) {
    speaker = m[1].trim();
    text = text.slice(m[0].length);
  }
  m = text.match(/^\[overlap\]\s*/i);
  if (m) {
    overlap = true;
    text = text.slice(m[0].length);
  }
  return { speaker, overlap, text };
}

function parseCues(text, vtt) {
  const segs = [];
  const blocks = text.replace(/^﻿/, "").replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    let body = lines.slice(ti + 1).join(" ");
    let speaker = null;
    if (vtt) {
      const v = body.match(/<v(?:\.[^ >]*)?\s+([^>]+)>/);
      if (v) speaker = v[1].trim();
      body = body.replace(/<\/?v[^>]*>/g, "");
    }
    const head = splitHead(body);
    const marked = head.text.trim();
    segs.push({
      start: round2(secs(a)), end: round2(secs(b.trim().split(/\s+/)[0])),
      speaker: normSpeaker(head.speaker || speaker), overlap: head.overlap,
      text: stripMarks(marked).replace(/\s+/g, " ").trim(), draft: marked,
    });
  }
  return segs;
}

// "[00:12 - 00:15] [S1]: text" (colab_dev_test_drafts.py .txt)
const TXT_LINE = /^\[\s*([\d:.,]+)\s*[-–]\s*([\d:.,]+)\s*\]\s*(?:\[([^\]]+)\]\s*:?)?\s*(.*)$/;
function parseTxt(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const timed = lines.map((l) => l.match(TXT_LINE));
  if (timed.length && timed.filter(Boolean).length >= timed.length * 0.8) {
    return timed.filter(Boolean).map((m) => {
      const head = splitHead(m[4]);
      return {
        start: round2(secs(m[1])), end: round2(secs(m[2])), speaker: normSpeaker(m[3] || head.speaker),
        overlap: head.overlap, text: stripMarks(head.text).trim(), draft: head.text.trim(),
      };
    });
  }
  // Untimed plain text: one segment; its end is set to the audio length once that is known.
  const all = lines.join(" ").trim();
  return all ? [{ start: 0, end: null, speaker: "S1", overlap: false, text: stripMarks(all), draft: all, untimed: true }] : [];
}

/**
 * Any supported transcript -> { segments, speakers, doc? }.
 * A file written by this app comes back whole as `doc`.
 */
export function parseTranscript(text, filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "json") {
    const obj = JSON.parse(text);
    if (obj && typeof obj.schema === "string" && obj.schema.startsWith("aimscribe-annotation")) return { doc: obj, segments: obj.segments };
    const list = Array.isArray(obj) ? obj : obj.segments || obj.turns || obj.utterances || obj.results || [];
    if (!Array.isArray(list)) throw new Error("No segments or turns list in this JSON file");
    const speakers = {};
    if (obj.speakers && typeof obj.speakers === "object" && !Array.isArray(obj.speakers)) {
      for (const [k, v] of Object.entries(obj.speakers)) speakers[k] = { role: (v && v.role) || "" };
    }
    return { segments: list.map(fromRecord).filter((s) => s.text || s.speaker === UNSURE || s.start != null), speakers };
  }
  if (ext === "srt") return { segments: parseCues(text, false), speakers: {} };
  if (ext === "vtt") return { segments: parseCues(text, true), speakers: {} };
  return { segments: parseTxt(text), speakers: {} };
}

export function sortSegments(segs) {
  return segs.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
}

/** Speakers in order of first speech, background and unassigned last. */
export function speakerList(segs, extra = {}) {
  const seen = [];
  for (const s of sortSegments([...segs])) if (!seen.includes(s.speaker)) seen.push(s.speaker);
  for (const k of Object.keys(extra)) if (!seen.includes(k)) seen.push(k);
  const tail = [BACKGROUND, UNSURE];
  return [...seen.filter((s) => !tail.includes(s)), ...tail.filter((s) => seen.includes(s))];
}

export function newDoc({ audio, sourceLabel, segments, speakers, user, mode = "draft" }) {
  const now = new Date().toISOString();
  const segs = sortSegments(segments.map((s) => ({
    start: s.start, end: s.end, speaker: s.speaker || "S1",
    text: mode === "timing" ? "" : s.text || "", overlap: !!s.overlap, checked: false,
    draft: mode === "timing" ? "" : s.draft ?? s.text ?? "",
  })));
  const sp = {};
  for (const k of speakerList(segs, speakers)) if (k !== BACKGROUND && k !== UNSURE) sp[k] = { role: speakers?.[k]?.role || "" };
  return {
    schema: SCHEMA, audio: audio.base, audio_file: audio.name, audio_file_id: audio.fileId,
    source: sourceLabel, start_mode: mode,
    annotator: { email: user.email, name: user.name },
    status: "in_progress", review: null, duration: null, speakers: sp, notes: "",
    time_spent_sec: 0, review_time_sec: 0, created: now, updated: now,
    segments: segs,
  };
}

export const speechSeconds = (segs) =>
  segs.reduce((t, s) => t + (s.speaker !== BACKGROUND && s.end > s.start ? s.end - s.start : 0), 0);

/** Drive properties for the file list (each key+value must stay under 124 bytes). */
export function docProperties(doc, saveid) {
  const cut = (s, maxBytes) => { // by UTF-8 bytes: a Bangla letter is 3 bytes
    let out = "";
    for (const ch of String(s ?? "")) {
      if (new TextEncoder().encode(out + ch).length > maxBytes) break;
      out += ch;
    }
    return out;
  };
  return {
    app: "aimscribe-annotator", audio: cut(doc.audio, 80), annotator: cut(doc.annotator?.email, 100),
    aname: cut(doc.annotator?.name, 60), status: doc.status, updated: doc.updated,
    checked: String(doc.segments.filter((s) => s.checked).length), total: String(doc.segments.length),
    dur: String(Math.round(doc.duration || 0)), speech: String(Math.round(speechSeconds(doc.segments))),
    spent: String(Math.round(doc.time_spent_sec || 0)), reviewer: cut(doc.review?.by, 100), saveid,
  };
}

function srtTime(s) {
  s = Math.max(0, s || 0);
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** Same line format as the drafts and scripts/annotation/import_corrected.py: "[S1] [overlap] text". */
export function docToSRT(doc) {
  return doc.segments.map((s, i) =>
    `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n[${s.speaker}]${s.overlap ? " [overlap]" : ""} ${s.text}\n`).join("\n");
}

/**
 * Draft text with pre-clean <font> marks -> safe HTML. Everything is escaped; only the known
 * marks become spans, and <ওষুধ=…>, <নাম>, [অস্পষ্ট] tags are shown as chips.
 */
export function renderMarked(s) {
  const parts = String(s ?? "").split(/(<font\b[^>]*>|<\/font>)/i);
  const stack = [];
  let html = "";
  for (const p of parts) {
    const open = p.match(/^<font\b[^>]*color\s*=\s*["']?([^"'\s>]+)/i);
    if (open) { stack.push(MARK_CLASS[open[1].toLowerCase()] || "mk-other"); continue; }
    if (/^<font\b/i.test(p)) { stack.push("mk-other"); continue; }
    if (/^<\/font>$/i.test(p)) { stack.pop(); continue; }
    if (!p) continue;
    let t = esc(p)
      .replace(/&lt;(\/?)(ওষুধ|নাম)((?:=[^&]*)?)&gt;/g, '<span class="tg">&lt;$1$2$3&gt;</span>')
      .replace(/\[(অস্পষ্ট|missed speech\?)\]/g, '<span class="tg">[$1]</span>');
    html += stack.length ? `<span class="${stack[stack.length - 1]}">${t}</span>` : t;
  }
  return html;
}

export const hasFlags = (s) =>
  /color\s*=\s*["']?#ff(4d4d|9900)/i.test(s.draft || "") || s.speaker === UNSURE || (s.text || "").includes(MISSED);

const DRUG = /<ওষুধ=([^>]*)>(.*?)<\/ওষুধ>/g;

/**
 * The checks import_corrected.py runs, done while annotating so nothing comes back from review
 * for a mechanical reason. Returns [{i, level: 'error'|'warn', msg}], i = segment index.
 */
export function checkDoc(doc) {
  const issues = [];
  const add = (i, level, msg) => issues.push({ i, level, msg });
  const lastEnd = {};
  doc.segments.forEach((s, i) => {
    const text = s.text || "";
    if (s.start == null || s.end == null || !(s.end > s.start)) add(i, "error", "start must be before end");
    else {
      if (s.end - s.start > 30) add(i, "error", "longer than 30 s: split it");
      else if (s.end - s.start > 25) add(i, "warn", "longer than 25 s: split at a pause if you can");
      if (s.start < (lastEnd[s.speaker] ?? -1) - 0.05) add(i, "warn", `${s.speaker} overlaps their own previous segment`);
      lastEnd[s.speaker] = Math.max(lastEnd[s.speaker] ?? 0, s.end);
    }
    if (s.speaker === UNSURE) add(i, "error", "choose a speaker");
    if (text.includes(MISSED)) add(i, "error", "[missed speech?] left in: transcribe it or delete the segment");
    if (!text.trim() && s.speaker !== BACKGROUND) add(i, "error", "empty segment: transcribe it, mark it পটভূমি, or delete it");
    if (text.trim() && s.speaker === BACKGROUND) add(i, "warn", "background voices get no text");
    for (const m of text.matchAll(DRUG)) {
      if (!m[1].trim()) add(i, "error", "drug tag without the drug-list name after =");
      if (/[A-Za-z]/.test(m[2])) add(i, "error", `drug '${m[1]}': write what was said in Bangla script inside the tag`);
    }
    const bare = text.replace(DRUG, "$2").replace(MISSED, "");
    if (/<\/?(ওষুধ|নাম)/.test(bare.replace(/<নাম>.*?<\/নাম>/g, ""))) add(i, "error", "a tag is not closed");
    if (/[A-Za-z]/.test(bare)) add(i, "error", "Latin letters: write English words in Bangla script");
    if (/[0-9০-৯]/.test(bare)) add(i, "error", "digits: write numbers as spoken words");
    if (!s.checked) add(i, "warn", "not ticked as checked yet");
  });
  return issues;
}
