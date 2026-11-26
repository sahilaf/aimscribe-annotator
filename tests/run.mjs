// Tests for the pure modules. Run from the repo root:  npm test (in annotator/)
import assert from "node:assert/strict";
import { buildProject, annotatorTag, FOLDER, itemStatus } from "../src/lib/project.js";
import { parseTranscript, newDoc, checkDoc, docToSRT, renderMarked, stripMarks, docProperties, speakerList } from "../src/lib/formats.js";
import { parseWav, wavPeaks, synthWav } from "../src/lib/audio.js";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok", name); };
const user = { email: "a@b", name: "A" };
const audio = { base: "G01", name: "G01.wav", fileId: "1" };

test("folder layout -> sets, sources ranked, private and raw files ignored", () => {
  const roots = [{ id: "r", name: "work" }];
  const F = (id, name, parent) => ({ id, name, mimeType: FOLDER, parent });
  const f = (id, name, parent, extra = {}) => ({ id, name, mimeType: "x", parent, ...extra });
  const p = buildProject([
    F("ts", "test_set", "r"), F("a", "audio16k", "ts"), F("ann", "annotation", "ts"), F("dr", "drafts_scribe", "ts"), F("c", "corrected", "ts"),
    f("1", "G01.wav", "a", { size: "1000" }), f("2", "G02.wav", "a"),
    f("3", "G01.json", "dr"), f("4", "G01_raw.json", "dr"), f("5", "G01.srt", "dr"), f("6", "G01.json", "ann"), f("7", "G01.txt", "dr"),
    f("8", "PRIVATE_id_map.json", "ts"),
    f("9", "G01__rahim.json", "c", { properties: { app: "aimscribe-annotator", audio: "G01", annotator: "rahim@x.com", status: "done" } }),
    F("flat", "phone_calls", "r"), f("10", "call_1.m4a", "flat"), f("11", "call_1_draft.txt", "flat"),
  ], roots);
  assert.equal(p.sets.length, 2);
  const ts = p.sets.find((s) => s.name === "work/test_set");
  assert.deepEqual(ts.items.map((i) => i.base), ["G01", "G02"]);
  const g1 = ts.items[0];
  assert.deepEqual(g1.sources.map((s) => s.label), ["annotation/G01.json", "drafts_scribe/G01.json", "drafts_scribe/G01.srt", "drafts_scribe/G01.txt"]);
  assert.equal(g1.outputs.length, 1);
  assert.equal(g1.outputs[0].status, "done");
  assert.equal(itemStatus(g1), "done");
  assert.equal(itemStatus(ts.items[1]), "todo");
  assert.deepEqual(ts.outputFolderIds, ["c"]);
  const flat = p.sets.find((s) => s.name === "work/phone_calls");
  assert.equal(flat.items[0].sources[0].name, "call_1_draft.txt");
});

test("annotator tag", () => {
  assert.equal(annotatorTag("Rahim.Uddin+x@gmail.com"), "rahim.uddin-x");
});

test("pre-clean JSON keeps marks as draft, clean text editable", () => {
  const r = parseTranscript(JSON.stringify({ segments: [{ start: 1, end: 2, speaker: "S1", text: 'a <font color="#3399ff">প্রেসার</font>', overlap: true }] }), "G01.json");
  assert.equal(r.segments[0].text, "a প্রেসার");
  assert.ok(r.segments[0].draft.includes("<font"));
  assert.equal(r.segments[0].overlap, true);
});

test("Scribe turns: low-logprob words become red marks; speaker_0 -> S1", () => {
  const r = parseTranscript(JSON.stringify({ turns: [{ start: 0, end: 1, speaker: "speaker_0", text: "ক খ",
    words: [{ text: "ক", type: "word", logprob: -0.1 }, { text: " ", type: "spacing" }, { text: "খ", type: "word", logprob: -2 }] }] }), "x.json");
  assert.equal(r.segments[0].speaker, "S1");
  assert.equal(r.segments[0].draft, 'ক <font color="#ff4d4d">খ</font>');
  assert.equal(r.segments[0].text, "ক খ");
});

test("SRT with [S2] [overlap] and a leading [অস্পষ্ট] tag", () => {
  const srt = "1\n00:00:01,500 --> 00:00:03,000\n[S2] [overlap] হ্যাঁ\n\n2\n00:01:00,000 --> 00:01:02,250\n[অস্পষ্ট] কথা\n";
  const r = parseTranscript(srt, "a.srt").segments;
  assert.deepEqual([r[0].start, r[0].end, r[0].speaker, r[0].overlap, r[0].text], [1.5, 3, "S2", true, "হ্যাঁ"]);
  assert.deepEqual([r[1].start, r[1].speaker, r[1].text], [60, "S1", "[অস্পষ্ট] কথা"]);
});

test("VTT voice tags", () => {
  const r = parseTranscript("WEBVTT\n\n00:01.000 --> 00:02.500 align:start\n<v S2>জি</v>\n", "a.vtt").segments;
  assert.deepEqual([r[0].start, r[0].end, r[0].speaker, r[0].text], [1, 2.5, "S2", "জি"]);
});

test("timed TXT from the Colab scripts, and untimed plain text", () => {
  const r = parseTranscript("[00:12 - 00:15] [S1]: জ্বর কত?\n[00:16 - 00:20] [S2]: একশো তিন\n", "a.txt").segments;
  assert.deepEqual([r[1].start, r[1].end, r[1].speaker, r[1].text], [16, 20, "S2", "একশো তিন"]);
  const u = parseTranscript("শুধু লেখা\nআরেক লাইন", "b.txt").segments;
  assert.equal(u.length, 1);
  assert.equal(u[0].untimed, true);
});

test("checks catch Latin, digits, missed speech, unassigned speaker, long and empty segments", () => {
  const doc = newDoc({ audio, sourceLabel: "x", user, speakers: {},
    segments: [
      { start: 0, end: 2, speaker: "S1", text: "Metformin খাই" },
      { start: 2, end: 3, speaker: "S1", text: "১৭০" },
      { start: 3, end: 4, speaker: "?", text: "[missed speech?]" },
      { start: 4, end: 40, speaker: "S2", text: "অনেক কথা" },
      { start: 41, end: 42, speaker: "S2", text: "" },
      { start: 43, end: 44, speaker: "S1", text: "<ওষুধ=Napa>নাপা</ওষুধ> খাবেন" },
      { start: 45, end: 46, speaker: "S1", text: "<ওষুধ=Napa>Napa</ওষুধ>" },
    ] });
  const by = (i) => checkDoc(doc).filter((x) => x.i === i && x.level === "error").map((x) => x.msg).join(" | ");
  assert.match(by(0), /Latin/);
  assert.match(by(1), /digits/);
  assert.match(by(2), /speaker/);
  assert.match(by(2), /missed/);
  assert.match(by(3), /30 s/);
  assert.match(by(4), /empty/);
  assert.equal(by(5), "");
  assert.match(by(6), /Bangla script inside the tag/);
});

test("timing-only start keeps times, drops text and draft", () => {
  const doc = newDoc({ audio, sourceLabel: "x", user, speakers: {}, mode: "timing",
    segments: [{ start: 0, end: 1, speaker: "S1", text: "লেখা", draft: "লেখা" }] });
  assert.equal(doc.segments[0].text, "");
  assert.equal(doc.segments[0].draft, "");
});

test("SRT export matches import_corrected.py format; properties stay short", () => {
  const doc = newDoc({ audio, sourceLabel: "x", user, speakers: {},
    segments: [{ start: 61.5, end: 63, speaker: "S2", text: "জি", overlap: true }] });
  assert.equal(docToSRT(doc), "1\n00:01:01,500 --> 00:01:03,000\n[S2] [overlap] জি\n");
  for (const [k, v] of Object.entries(docProperties(doc, "abc"))) assert.ok(new TextEncoder().encode(k + v).length <= 124, k);
  doc.annotator = { email: "x".repeat(200) + "@y.com", name: "সাহিল আল ফারিব ".repeat(10) }; // Bangla is 3 bytes a letter
  for (const [k, v] of Object.entries(docProperties(doc, "abc"))) assert.ok(new TextEncoder().encode(k + v).length <= 124, k);
});

test("renderMarked escapes everything except known marks", () => {
  const html = renderMarked('<script>x</script> <font color="#ff4d4d">a</font> <ওষুধ=Napa>নাপা</ওষুধ>');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('<span class="mk-red">a</span>'));
  assert.ok(html.includes('<span class="tg">&lt;ওষুধ=Napa&gt;</span>'));
  assert.equal(stripMarks('<font color="#fff">x</font>'), "x");
});

test("speaker order: first speech, background and unassigned last", () => {
  assert.deepEqual(speakerList([{ start: 5, speaker: "S2" }, { start: 1, speaker: "?" }, { start: 2, speaker: "পটভূমি" }, { start: 3, speaker: "S1" }]), ["S1", "S2", "পটভূমি", "?"]);
});

test("WAV header and peaks", () => {
  const buf = synthWav([{ start: 0.5, end: 1, speaker: "S1" }], 2);
  const info = parseWav(buf);
  assert.deepEqual([info.sampleRate, info.channels, info.bits, info.dataOffset], [16000, 1, 16, 44]);
  const p = wavPeaks(buf, info, 100);
  assert.equal(p.peaks.length, 200);
  assert.equal(p.duration, 2);
  assert.ok(Math.max(...p.peaks.slice(50, 100)) > p.peaks[10] * 5, "speech louder than room noise");
});

console.log(`\n${n} tests passed`);
