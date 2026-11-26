// Turns a flat Drive folder listing into annotation sets and items. Pure: no Drive calls here,
// so it is tested in tests/run.mjs and shared by the Drive and demo stores.
//
// Layout it understands (the one the Colab scripts write):
//   {set}/audio16k/G01.wav             the recording (any audio folder name in AUDIO_DIRS, or the set folder itself)
//   {set}/annotation/G01.json|srt      pre-cleaned draft (preclean_drafts.py), preferred
//   {set}/drafts_scribe/G01.json|srt   machine draft
//   {set}/corrected/G01__rahim.json    one file per annotator, written by this app
import { naturalCompare } from "./util.js";

export const FOLDER = "application/vnd.google-apps.folder";
export const SHORTCUT = "application/vnd.google-apps.shortcut";
export const APP_ID = "aimscribe-annotator";
export const OUTPUT_DIR = "corrected";

export const AUDIO_EXT = new Set(["wav", "mp3", "m4a", "ogg", "opus", "flac", "webm", "aac"]);
export const TEXT_EXT = new Set(["json", "srt", "vtt", "txt"]);
export const AUDIO_DIRS = new Set(["audio", "audio16k", "audio_16k", "wav", "wavs", "recordings"]);
// Folders never walked: model files, results and derived data hold nothing to annotate.
export const SKIP_DIRS = new Set([
  "models", "results", "scripts", "public_data", "trimmed_maps", "diar", "rttm", "clips",
  "eval_silver_v0", "__pycache__", ".ipynb_checkpoints", "private",
]);
const SOURCE_RANK = { annotation: 0, drafts_scribe: 1, drafts: 2, transcripts: 3, labels: 4 };
const EXT_RANK = { json: 0, srt: 1, vtt: 2, txt: 3 };
const DRAFT_SUFFIX = /[._-](draft|transcript|asr|labels?|turns)$/i;

export function splitName(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i + 1).toLowerCase()] : [name, ""];
}

/** PRIVATE_id_map.json and similar must never be listed or opened. */
export const isPrivate = (name) => /^private[_\-.]/i.test(name);

/** "Rahim.Uddin@gmail.com" -> "rahim.uddin": the annotator part of an output file name. */
export function annotatorTag(email) {
  const local = String(email || "anon").split("@")[0].toLowerCase();
  return local.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "anon";
}

export const outputName = (base, tag) => `${base}__${tag}.json`;

export function isAudio(e) {
  const [, ext] = splitName(e.name);
  return AUDIO_EXT.has(ext) || (e.mimeType || "").startsWith("audio/");
}

/**
 * entries: [{id, name, mimeType, parent, size, modifiedTime, properties, lastModifyingUser}]
 *          folders included; shortcuts already resolved by the store (target id, shortcut name).
 * roots:   [{id, name}]
 * returns  {sets: [{id, name, outputFolderIds, items}], count}
 */
export function buildProject(entries, roots) {
  const folders = new Map(roots.map((r) => [r.id, { id: r.id, name: r.name, parent: null, root: true }]));
  for (const e of entries) {
    if (e.mimeType === FOLDER && !folders.has(e.id)) folders.set(e.id, { id: e.id, name: e.name, parent: e.parent });
  }
  const fname = (id) => (folders.get(id)?.name || "").toLowerCase();
  const pathOf = (id) => {
    const parts = [];
    for (let f = folders.get(id), guard = 0; f && guard < 20; f = folders.get(f.parent), guard++) parts.unshift(f.name);
    return parts.join("/");
  };

  // 1. Audio decides where the sets are.
  const sets = new Map();
  const setFor = (audioParent) => {
    const f = folders.get(audioParent);
    if (f && AUDIO_DIRS.has(f.name.toLowerCase()) && f.parent && folders.has(f.parent)) return f.parent;
    return audioParent;
  };
  for (const e of entries) {
    if (e.mimeType === FOLDER || isPrivate(e.name) || !isAudio(e)) continue;
    if (fname(e.parent) === OUTPUT_DIR) continue;
    const sid = setFor(e.parent);
    if (!sets.has(sid)) sets.set(sid, { id: sid, name: pathOf(sid), outputFolderIds: [], items: new Map() });
    const [base] = splitName(e.name);
    const items = sets.get(sid).items;
    if (items.has(base)) continue; // G01.wav and G01.m4a: keep the first
    items.set(base, {
      key: `${sid}/${base}`, base, setId: sid,
      audio: { fileId: e.id, name: e.name, size: +e.size || 0, mimeType: e.mimeType, modifiedTime: e.modifiedTime },
      sources: [], outputs: [],
    });
  }

  // 2. Every other file is a draft or an output of the nearest set above it.
  const nearestSet = (folderId) => {
    for (let id = folderId, guard = 0; id && guard < 6; id = folders.get(id)?.parent, guard++) {
      if (sets.has(id)) return id;
    }
    return null;
  };
  for (const e of entries) {
    if (e.mimeType === FOLDER) {
      if (e.name.toLowerCase() === OUTPUT_DIR && sets.has(e.parent)) sets.get(e.parent).outputFolderIds.push(e.id);
      continue;
    }
    if (isPrivate(e.name) || isAudio(e)) continue;
    const [base, ext] = splitName(e.name);
    if (!TEXT_EXT.has(ext) || /_raw(_|$)/i.test(base)) continue;
    const sid = nearestSet(e.parent);
    if (!sid) continue;
    const set = sets.get(sid);
    const props = e.properties || {};
    const inOutput = fname(e.parent) === OUTPUT_DIR;

    if (inOutput && ext === "json" && (props.app === APP_ID || base.includes("__"))) {
      const audioBase = props.audio || base.slice(0, base.lastIndexOf("__"));
      const item = set.items.get(audioBase);
      if (!item) continue;
      item.outputs.push({
        fileId: e.id, name: e.name, folderId: e.parent,
        tag: base.slice(base.lastIndexOf("__") + 2),
        annotator: props.annotator || "", annotatorName: props.aname || base.slice(base.lastIndexOf("__") + 2),
        status: props.status || "in_progress", updated: props.updated || e.modifiedTime,
        checked: +props.checked || 0, total: +props.total || 0, duration: +props.dur || 0,
        speech: +props.speech || 0, spent: +props.spent || 0, reviewer: props.reviewer || "",
        saveid: props.saveid || "", lastBy: e.lastModifyingUser?.emailAddress || "",
      });
      continue;
    }
    let item = set.items.get(base);
    if (!item && DRAFT_SUFFIX.test(base)) item = set.items.get(base.replace(DRAFT_SUFFIX, ""));
    if (!item) continue;
    const folder = folders.get(e.parent);
    const rel = e.parent === sid ? e.name : `${folder?.name || "?"}/${e.name}`;
    const dir = (folder?.name || "").toLowerCase();
    item.sources.push({
      fileId: e.id, name: e.name, label: rel, ext,
      rank: (e.parent === sid ? 5 : SOURCE_RANK[dir] ?? (inOutput ? 6 : 7)) * 10 + (EXT_RANK[ext] ?? 9),
    });
  }

  const out = [...sets.values()].map((s) => {
    const items = [...s.items.values()].sort((a, b) => naturalCompare(a.base, b.base));
    for (const it of items) {
      it.sources.sort((a, b) => a.rank - b.rank || naturalCompare(a.label, b.label));
      it.outputs.sort((a, b) => naturalCompare(a.annotatorName, b.annotatorName));
    }
    return { ...s, items };
  });
  out.sort((a, b) => naturalCompare(a.name, b.name));
  return { sets: out, count: out.reduce((n, s) => n + s.items.length, 0) };
}

/** Overall status of an item for the file list: the most advanced output wins. */
const STATUS_ORDER = ["todo", "in_progress", "returned", "done", "reviewed"];
export function itemStatus(item) {
  let best = "todo";
  for (const o of item.outputs) if (STATUS_ORDER.indexOf(o.status) > STATUS_ORDER.indexOf(best)) best = o.status;
  return best;
}
