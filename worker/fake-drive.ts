// Local testing only (DEMO=1 in .dev.vars): an in-memory "Drive" with two made-up sets and
// synthetic audio, so the whole admin → annotator → dashboard flow can be tried without Google.
import type { Drive, Entry } from "./drive";
import { DriveError } from "./drive";
import { DEMO_DATA } from "../src/lib/demo.js";
import { synthWav } from "../src/lib/audio.js";

const FOLDER = "application/vnd.google-apps.folder";
interface Node { entry: Entry; text?: string; audio?: { segs: unknown[]; dur: number }; bytes?: ArrayBuffer }

const files = new Map<string, Node>();
let seq = 0;
const now = () => new Date().toISOString();
const owner = { displayName: "Drive owner (demo)", emailAddress: "owner@demo.test" };

function add(id: string, name: string, parent: string, extra: Partial<Node> = {}, mimeType = "application/json") {
  files.set(id, { entry: { id, name, mimeType, parent, parents: [parent], modifiedTime: now(), lastModifyingUser: owner }, ...extra });
}

function seed() {
  if (files.size) return;
  const { TEXTS, AUDIO } = DEMO_DATA;
  const srt = TEXTS["d-D03"];
  const drafts = [
    { text: TEXTS["d-D01"], ext: "json", audio: AUDIO["w-D01"], pre: TEXTS["a-D01"] },
    { text: TEXTS["d-D02"], ext: "json", audio: AUDIO["w-D02"] },
    { text: srt, ext: "srt", audio: AUDIO["w-D03"] },
  ];
  for (const [set, prefix, n] of [["test_set", "G", 4], ["train_set", "T", 9]] as const) {
    const sid = `demo-${set}`;
    add(sid, set, "root", {}, FOLDER);
    add(`${sid}-audio`, "audio16k", sid, {}, FOLDER);
    add(`${sid}-drafts`, "drafts_scribe", sid, {}, FOLDER);
    add(`${sid}-private`, "PRIVATE_id_map.json", sid, { text: "{}" });
    for (let i = 1; i <= n; i++) {
      const base = prefix === "G" ? `G${String(i).padStart(2, "0")}` : `T${String(i).padStart(3, "0")}`;
      const d = drafts[(i - 1) % drafts.length];
      const size = String(44 + Math.round(d.audio.dur * 32000));
      add(`${sid}-w-${base}`, `${base}.wav`, `${sid}-audio`, { audio: d.audio }, "audio/wav");
      files.get(`${sid}-w-${base}`)!.entry.size = size;
      if (i === n) continue; // the last file has no draft: it opens blank
      add(`${sid}-d-${base}`, `${base}.${d.ext}`, `${sid}-drafts`, { text: d.text });
      if (d.pre && prefix === "G") {
        if (!files.has(`${sid}-ann`)) add(`${sid}-ann`, "annotation", sid, {}, FOLDER);
        add(`${sid}-a-${base}`, `${base}.json`, `${sid}-ann`, { text: d.pre });
      }
    }
  }
}

export const DEMO_FOLDERS = [{ id: "demo-test_set", name: "test_set" }, { id: "demo-train_set", name: "train_set" }];

export class FakeDrive implements Drive {
  constructor() { seed(); }

  async account() { return { email: owner.emailAddress, name: owner.displayName }; }

  async meta(fileId: string) {
    const n = files.get(fileId);
    if (!n) throw new DriveError("not_found", "Not found", 404);
    return { ...n.entry };
  }

  async children(ids: string[]) {
    return [...files.values()].filter((n) => ids.includes(n.entry.parent!) && !n.entry.trashed).map((n) => ({ ...n.entry }));
  }

  async findByName(name: string, parentId: string | null) {
    return [...files.values()].filter((n) => n.entry.name === name && (n.entry.parent === (parentId || "root"))).map((n) => ({ ...n.entry }));
  }

  async media(fileId: string, range?: string | null) {
    const n = files.get(fileId);
    if (!n) throw new DriveError("not_found", "Not found", 404);
    if (n.audio && !n.bytes) n.bytes = synthWav(n.audio.segs, n.audio.dur) as ArrayBuffer;
    const body: ArrayBuffer = n.bytes || new TextEncoder().encode(n.text || "").buffer as ArrayBuffer;
    const type = n.audio ? "audio/wav" : "application/json";
    const m = range?.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const a = +m[1], b = m[2] ? Math.min(+m[2], body.byteLength - 1) : body.byteLength - 1;
      return new Response(body.slice(a, b + 1), { status: 206, headers: { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${body.byteLength}`, "Content-Length": String(b - a + 1), "Accept-Ranges": "bytes" } });
    }
    return new Response(body, { headers: { "Content-Type": type, "Content-Length": String(body.byteLength), "Accept-Ranges": "bytes" } });
  }

  async text(fileId: string) {
    const n = files.get(fileId);
    if (!n) throw new DriveError("not_found", "Not found", 404);
    return n.text || "";
  }

  async createFolder(name: string, parentId: string) {
    const id = `demo-new-${++seq}`;
    add(id, name, parentId, {}, FOLDER);
    return id;
  }

  async createJson(parentId: string, name: string, content: string, properties: Record<string, string | null>) {
    const id = `demo-new-${++seq}`;
    add(id, name, parentId, { text: content });
    files.get(id)!.entry.properties = Object.fromEntries(Object.entries(properties).filter(([, v]) => v)) as Record<string, string>;
    return { ...files.get(id)!.entry };
  }

  async updateJson(fileId: string, content: string, properties: Record<string, string | null>) {
    const n = files.get(fileId);
    if (!n) throw new DriveError("not_found", "Not found", 404);
    n.text = content;
    const props = { ...(n.entry.properties || {}) };
    for (const [k, v] of Object.entries(properties)) { if (v == null || v === "") delete props[k]; else props[k] = v; }
    n.entry.properties = props;
    n.entry.modifiedTime = now();
    return { ...n.entry };
  }
}
