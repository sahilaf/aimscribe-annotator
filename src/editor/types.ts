// Shapes shared by the editor. The data modules in src/lib are plain JS (also used by the Node
// tests); these interfaces describe what they return.

export interface Seg {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  overlap: boolean;
  checked: boolean;
  draft: string;
}

export interface Review { by: string; name: string; at: string; note: string }

export type Status = "in_progress" | "done" | "returned" | "reviewed";

export interface Doc {
  schema: string;
  audio: string;
  audio_file: string;
  audio_file_id?: string;
  source: string;
  start_mode: string;
  annotator: { email: string; name: string };
  status: Status;
  review: Review | null;
  duration: number | null;
  speakers: Record<string, { role: string }>;
  notes: string;
  time_spent_sec: number;
  review_time_sec: number;
  created: string;
  updated: string;
  segments: Omit<Seg, "id">[];
}

export interface Output {
  fileId: string;
  name: string;
  folderId: string;
  tag: string;
  annotator: string;
  annotatorName: string;
  status: Status;
  updated: string;
  checked: number;
  total: number;
  duration: number;
  speech: number;
  spent: number;
  reviewer: string;
  saveid: string;
}

export interface Source { fileId: string; name: string; label: string; ext: string; rank: number }

export interface Item {
  key: string;
  base: string;
  setId: string;
  audio: { fileId: string; name: string; size: number; mimeType: string };
  sources: Source[];
  outputs: Output[];
}

export interface DataSet { id: string; name: string; outputFolderIds: string[]; items: Item[] }
export interface Project { sets: DataSet[]; count: number }

export interface Peaks { peaks: Float32Array; perSec: number; duration: number }

export interface User { email: string; name: string; photo?: string }
export interface Root { id: string; name: string; driveId?: string | null; unresolved?: boolean }

export interface Store {
  kind: "drive" | "demo";
  user: User | null;
  expiresAt: number;
  token?: string | null;
  client?: unknown;
  onAuthNeeded: null | (() => Promise<void>);
  init(): Promise<void>;
  signIn(firstTime?: boolean): Promise<User>;
  signOut(): void;
  resolveFolder(input: string): Promise<Root>;
  listProject(roots: Root[], onProgress?: (msg: string) => void): Promise<Project>;
  getText(fileId: string): Promise<string>;
  getAudio(fileId: string, size: number, onProgress?: (p: number) => void): Promise<ArrayBuffer>;
  getProps(fileId: string): Promise<{ properties: Record<string, string>; modifiedTime?: string; lastBy: string; trashed?: boolean }>;
  findByName(folderId: string, name: string): Promise<{ id: string; properties?: Record<string, string> } | null>;
  ensureOutputFolder(set: DataSet): Promise<string>;
  createJson(folderId: string, name: string, content: string, properties: Record<string, string>): Promise<{ id: string }>;
  updateJson(fileId: string, content: string, properties: Record<string, string>): Promise<{ id: string }>;
}

export type StartPlan =
  | { kind: "own" | "review"; output: Output }
  | { kind: "new"; source: Source | null; from?: string | null; blank?: boolean; timing?: boolean };
