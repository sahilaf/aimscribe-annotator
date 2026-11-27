// The app's own records live in one JSON file in the owner's Drive (My Drive root):
// aimscribe-annotator-state.json = who has joined, their role, which files are assigned to whom,
// and which Drive folders hold the sets. Nothing about the project is stored on Cloudflare.
import type { Drive, Entry } from "./drive";
import type { Env } from "./env";
import { DEMO_FOLDERS } from "./fake-drive";
import { buildProject, FOLDER, SHORTCUT, SKIP_DIRS, isPrivate, OUTPUT_DIR } from "../src/lib/project.js";

export type Role = "annotator" | "reviewer" | "admin";
export type Status = "pending" | "active" | "blocked";
export interface User { name: string; picture?: string; role: Role; status: Status; joined: string }
export interface Assignment { email: string; kind: "annotate" | "review"; at: string; by: string }
export interface Root { id: string; name: string; driveId?: string | null }
export interface State {
  version: 1;
  updated: string;
  folders: Root[];
  users: Record<string, User>;
  assignments: Record<string, Assignment[]>; // item key "<setFolderId>/<ID>" -> who works on it
}

const STATE_NAME = "aimscribe-annotator-state.json";
const TTL = 15e3;
let cache: { state: State; fileId: string | null; at: number } | null = null;

const empty = (env: Env): State => ({
  version: 1, updated: new Date().toISOString(), folders: env.DEMO === "1" ? [...DEMO_FOLDERS] : [], users: {}, assignments: {},
});

export async function loadState(drive: Drive, env: Env, fresh = false): Promise<{ state: State; fileId: string | null }> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache;
  const hit = (await drive.findByName(STATE_NAME, null))[0];
  let state = empty(env);
  if (hit) {
    try { state = { ...state, ...JSON.parse(await drive.text(hit.id)) }; } catch { /* unreadable file: start from empty, keep the file id */ }
  }
  cache = { state, fileId: hit?.id || null, at: Date.now() };
  return cache;
}

/** Read the latest copy, apply the change, write it back. */
export async function updateState(drive: Drive, env: Env, change: (s: State) => void) {
  const { state, fileId } = await loadState(drive, env, true);
  change(state);
  state.updated = new Date().toISOString();
  const content = JSON.stringify(state, null, 1);
  const props = { app: "aimscribe-annotator-state" };
  const saved = fileId ? await drive.updateJson(fileId, content, props) : await drive.createJson("root", STATE_NAME, content, props);
  cache = { state, fileId: saved.id || fileId, at: Date.now() };
  return state;
}

// ---------------------------------------------------------------- project index

export interface Indexed {
  project: { sets: any[]; count: number };
  items: Map<string, any>; // key -> item
  files: Map<string, { item: any; kind: "audio" | "source" | "output"; output?: any }>;
  outputFolders: Map<string, any>; // corrected/ folder id -> set
  sets: Map<string, any>;
  at: number;
  rootsKey: string;
}
let index: Indexed | null = null;
const INDEX_TTL = 30e3;

export function invalidateIndex() { index = null; }

/** Walk the set folders (one request per level) and match audio, drafts and outputs. */
export async function getIndex(drive: Drive, roots: Root[], fresh = false): Promise<Indexed> {
  const rootsKey = roots.map((r) => r.id).join(",");
  if (!fresh && index && index.rootsKey === rootsKey && Date.now() - index.at < INDEX_TTL) return index;
  const entries: Entry[] = [];
  const seen = new Set(roots.map((r) => r.id));
  for (const root of roots) {
    let level = [root.id];
    for (let depth = 0; depth < 4 && level.length; depth++) {
      const kids = await drive.children(level, root.driveId);
      const next: string[] = [];
      for (let f of kids) {
        if (f.mimeType === SHORTCUT && f.shortcutDetails) f = { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, size: undefined };
        if (isPrivate(f.name)) continue;
        if (f.mimeType === FOLDER) {
          const n = f.name.toLowerCase();
          if (seen.has(f.id) || (SKIP_DIRS.has(n) && n !== OUTPUT_DIR)) continue;
          seen.add(f.id);
          next.push(f.id);
        }
        entries.push(f);
      }
      level = next;
    }
  }
  const project = buildProject(entries, roots);
  // who last saved each output (all saves go through the owner's account, so the app records the person)
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx: Indexed = { project, items: new Map(), files: new Map(), outputFolders: new Map(), sets: new Map(), at: Date.now(), rootsKey };
  for (const set of project.sets) {
    idx.sets.set(set.id, set);
    for (const f of set.outputFolderIds) idx.outputFolders.set(f, set);
    for (const it of set.items) {
      idx.items.set(it.key, it);
      idx.files.set(it.audio.fileId, { item: it, kind: "audio" });
      for (const s of it.sources) idx.files.set(s.fileId, { item: it, kind: "source" });
      for (const o of it.outputs) {
        o.lastBy = byId.get(o.fileId)?.properties?.lastby || "";
        idx.files.set(o.fileId, { item: it, kind: "output", output: o });
      }
    }
  }
  index = idx;
  return idx;
}
