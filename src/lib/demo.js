// Demo store: same interface as DriveStore, but with made-up files and synthetic audio, saved in
// this browser only. Lets the team learn the tool, and lets it be tested, without Google.
// The consultation lines are invented; there is no patient data here.
import { buildProject, FOLDER } from "./project.js";
import { synthWav } from "./audio.js";
import { sleep } from "./util.js";

const B = '<font color="#3399ff">', R = '<font color="#ff4d4d">', O = '<font color="#ff9900">', E = "</font>";

const D01 = {
  id: "D01", note: "pre-cleaned Scribe v2 draft; uncorrected (demo)",
  segments: [
    { start: 0.6, end: 3.2, speaker: "S1", text: "আসসালামু আলাইকুম, বসেন। কী সমস্যা নিয়ে আসছেন?", overlap: false },
    { start: 3.6, end: 8.9, speaker: "S2", text: `স্যার, তিন দিন ধরে জ্বর, সাথে মাথা ব্যথা আর ${R}গা${E} ব্যথা।`, overlap: false },
    { start: 9.3, end: 12.0, speaker: "S1", text: "জ্বর কত উঠছিল, মাপছিলেন?", overlap: false },
    { start: 12.4, end: 16.8, speaker: "S2", text: `${B}একশো তিন${E} পর্যন্ত উঠছিল।`, overlap: false },
    { start: 17.2, end: 21.5, speaker: "S1", text: `${B}প্রেসার${E} কেমন থাকে আপনার? ${B}ডায়াবেটিস${E} আছে?`, overlap: false },
    { start: 21.0, end: 23.0, speaker: "S3", text: "হ্যাঁ, ওনার সুগার আছে।", overlap: true },
    { start: 23.6, end: 27.4, speaker: "S2", text: `সুগার আছে, ${O}Metformin${E} খাই।`, overlap: false },
    { start: 28.0, end: 31.0, speaker: "?", text: `${R}[missed speech?]${E}`, overlap: false },
    { start: 31.5, end: 37.8, speaker: "S1", text: `ঠিক আছে, ${B}<ওষুধ=Napa>নাপা</ওষুধ>${E} একটা করে দিনে তিনবার খাবেন।`, overlap: false },
    { start: 38.2, end: 42.0, speaker: "S1", text: `আর একটা ${B}সিবিসি${E} টেস্ট করায় নিয়ে আসবেন।`, overlap: false },
    { start: 42.6, end: 45.0, speaker: "S2", text: "আচ্ছা স্যার, ধন্যবাদ।", overlap: false },
  ],
};

const w = (text, start, end, logprob = -0.1) => ({ text, start, end, type: "word", logprob });
const sp = { text: " ", type: "spacing" };
const D02 = {
  id: "D02", asr_model: "demo", note: "machine draft, uncorrected (demo)",
  turns: [
    { start: 0.8, end: 4.6, speaker: "S1", text: "আজকে কেমন আছেন? ঘুম ঠিকমতো হয়?",
      words: [w("আজকে", 0.8, 1.3), sp, w("কেমন", 1.3, 1.8), sp, w("আছেন?", 1.8, 2.4), sp, w("ঘুম", 2.8, 3.2), sp, w("ঠিকমতো", 3.2, 4.0, -1.6), sp, w("হয়?", 4.0, 4.6)] },
    { start: 5.1, end: 11.4, speaker: "S2", text: "না স্যার, রাতে ঘুম আসে না, বুক ধড়ফড় করে।",
      words: [w("না", 5.1, 5.4), sp, w("স্যার,", 5.4, 6.0), sp, w("রাতে", 6.3, 6.9), sp, w("ঘুম", 6.9, 7.4), sp, w("আসে", 7.4, 7.9), sp, w("না,", 7.9, 8.4), sp, w("বুক", 9.0, 9.6), sp, w("ধড়ফড়", 9.6, 10.6, -2.3), sp, w("করে।", 10.6, 11.4)] },
    { start: 12.0, end: 18.5, speaker: "S1", text: "ইসিজি টা করে ফেলি, আর প্রেসারের ওষুধ চালু থাকবে।",
      words: [w("ইসিজি", 12.0, 12.9, -1.2), sp, w("টা", 12.9, 13.2), sp, w("করে", 13.2, 13.7), sp, w("ফেলি,", 13.7, 14.4), sp, w("আর", 14.8, 15.1), sp, w("প্রেসারের", 15.1, 16.2), sp, w("ওষুধ", 16.2, 16.8), sp, w("চালু", 16.8, 17.5), sp, w("থাকবে।", 17.5, 18.5)] },
    { start: 19.2, end: 22.0, speaker: "S2", text: "জি আচ্ছা।", words: [w("জি", 19.2, 19.8), sp, w("আচ্ছা।", 19.8, 22.0)] },
  ],
};

const D03 = `1
00:00:00,500 --> 00:00:04,200
[S1] কয়দিন ধরে কাশি হচ্ছে?

2
00:00:04,600 --> 00:00:09,800
[S2] এক সপ্তাহ, রাতে বেশি হয়।

3
00:00:10,200 --> 00:00:15,000
[S1] [overlap] ঠিক আছে, এক্সরে করে দেখি।
`;

const TEXTS = {
  "a-D01": JSON.stringify(D01), "d-D01": JSON.stringify({ id: "D01", turns: D01.segments.map((s) => ({ ...s, text: s.text.replace(/<\/?font[^>]*>/g, "") })) }),
  "d-D02": JSON.stringify(D02), "d-D02raw": "{}", "d-D03": D03, "x-private": "{}",
};
const AUDIO = {
  "w-D01": { segs: D01.segments, dur: 48 },
  "w-D02": { segs: D02.turns, dur: 24 },
  "w-D03": { segs: [{ start: 0.5, end: 4.2, speaker: "S1" }, { start: 4.6, end: 9.8, speaker: "S2" }, { start: 10.2, end: 15, speaker: "S1" }], dur: 17 },
};

const ROOT = { id: "demo-root", name: "demo_project" };
const STATIC = [
  { id: "f-set", name: "demo_set", mimeType: FOLDER, parent: ROOT.id },
  { id: "f-audio", name: "audio16k", mimeType: FOLDER, parent: "f-set" },
  { id: "f-ann", name: "annotation", mimeType: FOLDER, parent: "f-set" },
  { id: "f-dr", name: "drafts_scribe", mimeType: FOLDER, parent: "f-set" },
  { id: "x-private", name: "PRIVATE_id_map.json", mimeType: "application/json", parent: "f-set" },
  ...["D01", "D02", "D03"].map((b) => ({ id: `w-${b}`, name: `${b}.wav`, mimeType: "audio/wav", parent: "f-audio",
    size: 44 + AUDIO[`w-${b}`].dur * 32000 })),
  { id: "a-D01", name: "D01.json", mimeType: "application/json", parent: "f-ann" },
  { id: "d-D01", name: "D01.json", mimeType: "application/json", parent: "f-dr" },
  { id: "d-D02", name: "D02.json", mimeType: "application/json", parent: "f-dr" },
  { id: "d-D02raw", name: "D02_raw.json", mimeType: "application/json", parent: "f-dr" },
  { id: "d-D03", name: "D03.srt", mimeType: "application/x-subrip", parent: "f-dr" },
];

const KEY = "aimscribe:demo:files";
const load = () => JSON.parse(localStorage.getItem(KEY) || "{}");
const persist = (files) => localStorage.setItem(KEY, JSON.stringify(files));

function seedOther(files) {
  // A finished annotation by a made-up teammate, so the review flow can be tried.
  if (Object.values(files).some((f) => f.properties?.annotator === "rahim@demo")) return;
  const segs = D02.turns.map((t) => ({ start: t.start, end: t.end, speaker: t.speaker, text: t.text.replace("ইসিজি টা", "ইসিজিটা"), overlap: false, checked: true, draft: t.text }));
  const now = new Date(Date.now() - 3 * 3600e3).toISOString();
  const doc = { schema: "aimscribe-annotation/1", audio: "D02", audio_file: "D02.wav", source: "drafts_scribe/D02.json", start_mode: "draft",
    annotator: { email: "rahim@demo", name: "Rahim (demo)" }, status: "done", review: null, duration: 24,
    speakers: { S1: { role: "ডাক্তার" }, S2: { role: "রোগী" } }, notes: "", time_spent_sec: 610, review_time_sec: 0,
    created: now, updated: now, segments: segs };
  files["o-seed"] = { name: "D02__rahim.json", folderId: "f-out", content: JSON.stringify(doc), modifiedTime: now,
    properties: { app: "aimscribe-annotator", audio: "D02", annotator: "rahim@demo", aname: "Rahim (demo)", status: "done",
      updated: now, checked: "4", total: "4", dur: "24", speech: "19", spent: "610", reviewer: "", saveid: "seed" } };
}

export class DemoStore {
  constructor() {
    this.kind = "demo";
    this.user = null;
    this.expiresAt = Infinity;
  }
  async init() {}
  async signIn() {
    this.user = { email: "you@demo", name: "You (demo)" };
    return this.user;
  }
  signOut() { this.user = null; }
  async resolveFolder() { return { ...ROOT }; }

  async listProject() {
    await sleep(150);
    const files = load();
    seedOther(files);
    persist(files);
    const out = [{ id: "f-out", name: "corrected", mimeType: FOLDER, parent: "f-set" }];
    for (const [id, f] of Object.entries(files)) {
      out.push({ id, name: f.name, mimeType: "application/json", parent: f.folderId, properties: f.properties, modifiedTime: f.modifiedTime });
    }
    return buildProject([...STATIC, ...out], [ROOT]);
  }

  async getText(id) {
    if (TEXTS[id]) return TEXTS[id];
    const f = load()[id];
    if (!f) throw new Error("Not found");
    return f.content;
  }

  async getAudio(id, size, onProgress) {
    for (let p = 0; p <= 1; p += 0.25) {
      onProgress?.(p);
      await sleep(120);
    }
    const a = AUDIO[id];
    return synthWav(a.segs, a.dur);
  }

  async getProps(id) {
    const f = load()[id];
    return { properties: f?.properties || {}, modifiedTime: f?.modifiedTime, lastBy: f?.properties?.aname || "" };
  }

  async findByName(folderId, name) {
    const hit = Object.entries(load()).find(([, f]) => f.folderId === folderId && f.name === name);
    return hit ? { id: hit[0], properties: hit[1].properties } : null;
  }

  async ensureOutputFolder(set) {
    if (!set.outputFolderIds.length) set.outputFolderIds.push("f-out");
    return set.outputFolderIds[0];
  }

  async createJson(folderId, name, content, properties) {
    await sleep(200);
    const files = load();
    const id = "o-" + Math.random().toString(36).slice(2, 9);
    files[id] = { name, folderId, content, properties, modifiedTime: new Date().toISOString() };
    persist(files);
    return { id };
  }

  async updateJson(id, content, properties) {
    await sleep(200);
    const files = load();
    if (!files[id]) throw new Error("Not found");
    Object.assign(files[id], { content, properties, modifiedTime: new Date().toISOString() });
    persist(files);
    return { id };
  }
}

export function resetDemo() {
  localStorage.removeItem(KEY);
  for (const k of Object.keys(localStorage)) if (k.startsWith("aimscribe:local:demo:")) localStorage.removeItem(k);
}

// Shared with the local test backend (worker/fake-drive.ts).
export const DEMO_DATA = { ROOT, STATIC, TEXTS, AUDIO, D01, D02, D03 };
