// Talks to the Worker backend (worker/index.ts). Teammates sign in with Google for their email
// only; every file goes through the backend, which reads and writes the project owner's Drive.
import { readWithProgress } from "./audio.js";
import type { DataSet, Project, Root, Store, User } from "@/editor/types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Me {
  email: string; name: string; picture?: string;
  role: "annotator" | "reviewer" | "admin"; status: "pending" | "active" | "blocked";
  isAdmin: boolean; drive: { connected: boolean }; demo: boolean; noAdmin: boolean;
}

declare const google: any;

function waitForGis(ms = 15000) {
  return new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if ((window as any).google?.accounts?.oauth2) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error("Google sign-in did not load. Check the connection or an ad blocker."));
      setTimeout(poll, 100);
    })();
  });
}

export class ApiStore implements Store {
  kind = "api" as const;
  user: User | null = null;
  me: Me | null = null;
  expiresAt = Infinity;
  onAuthNeeded: null | (() => Promise<void>) = null;
  client: any = null;
  private pending: { resolve: (r: any) => void; reject: (e: any) => void } | null = null;

  constructor(private clientId: string) {}

  async init() {
    await waitForGis();
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: "openid email profile", // identity only: no Drive permission is asked of teammates
      callback: (r: any) => this.pending?.resolve(r),
      error_callback: (e: any) => this.pending?.reject(e),
    });
  }

  /** Must run inside a click: Google opens a popup. */
  signIn(): Promise<User> {
    return new Promise((resolve, reject) => {
      this.pending = {
        resolve: async (r: any) => {
          this.pending = null;
          if (r.error) return reject(new Error(r.error_description || r.error));
          try {
            await this.send("/api/session", { accessToken: r.access_token }, "POST", false);
            await this.loadMe();
            resolve(this.user!);
          } catch (e) { reject(e); }
        },
        reject: (e: any) => {
          this.pending = null;
          reject(new Error(e?.type === "popup_failed_to_open" ? "The sign-in popup was blocked. Allow popups for this site." :
            e?.type === "popup_closed" ? "The sign-in window was closed." : e?.message || "Sign-in failed"));
        },
      };
      const hint = localStorage.getItem("aimscribe:hint") || undefined;
      this.client.requestAccessToken({ prompt: hint ? "" : "select_account", login_hint: hint });
    });
  }

  /** Local test backend only: sign in by typing an email. */
  async devSignIn(email: string) {
    await this.send("/api/session", { devEmail: email }, "POST", false);
    await this.loadMe();
    return this.user!;
  }

  /** An existing session cookie means no sign-in screen. */
  async restore() {
    try { return await this.loadMe(); } catch { return null; }
  }

  async loadMe() {
    const me = (await (await this.call("/api/me", {}, false)).json()) as Me;
    this.me = me;
    this.user = { email: me.email, name: me.name, photo: me.picture };
    localStorage.setItem("aimscribe:hint", me.email);
    return me;
  }

  signOut() {
    fetch("/api/logout", { method: "POST" }).catch(() => {});
    this.user = this.me = null;
  }

  private async call(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await fetch(path, { credentials: "same-origin", ...init });
    if (res.status === 401 && retry && this.onAuthNeeded) {
      await this.onAuthNeeded();
      return this.call(path, init, false);
    }
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ApiError(res.status, b.error || "error", b.message || `${res.status} ${res.statusText}`);
    }
    return res;
  }

  async get<T = any>(path: string): Promise<T> {
    return (await this.call(path)).json();
  }

  async send<T = any>(path: string, data: unknown, method = "POST", retry = true): Promise<T> {
    const res = await this.call(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }, retry);
    return res.json();
  }

  // ---------------------------------------------------------------- Store interface used by the editor
  async resolveFolder(): Promise<Root> { throw new Error("Folders are managed by the admin"); }
  listProject(): Promise<Project> { return this.get("/api/tasks"); }
  async getText(fileId: string) { return (await this.call(`/api/file/${fileId}/text`)).text(); }
  async getAudio(fileId: string, size: number, onProgress?: (p: number) => void) {
    return readWithProgress(await this.call(`/api/file/${fileId}/media`), size, onProgress);
  }
  getProps(fileId: string) { return this.get(`/api/file/${fileId}/props`); }
  findByName(folderId: string, name: string) {
    return this.get(`/api/find?folder=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name)}`);
  }
  async ensureOutputFolder(set: DataSet) {
    if (set.outputFolderIds.length) return set.outputFolderIds[0];
    const { id } = await this.send<{ id: string }>(`/api/sets/${set.id}/corrected`, {});
    set.outputFolderIds.push(id);
    return id;
  }
  createJson(folderId: string, name: string, content: string, properties: Record<string, string>) {
    return this.send("/api/files", { folderId, name, content, properties });
  }
  updateJson(fileId: string, content: string, properties: Record<string, string>) {
    return this.send(`/api/files/${fileId}`, { content, properties }, "PUT");
  }

  // ---------------------------------------------------------------- admin
  overview(fresh = false) { return this.get<Overview>(`/api/admin/overview${fresh ? "?fresh=1" : ""}`); }
  folder(change: { add?: string; remove?: string }) { return this.send("/api/admin/folders", change); }
  person(change: { email: string; name?: string; role?: string; status?: string; remove?: boolean }) { return this.send("/api/admin/users", change); }
  assign(change: { keys: string[]; email: string; kind: "annotate" | "review"; action: "add" | "remove" }) { return this.send("/api/admin/assign", change); }
}

export interface Person { email: string; name: string; picture?: string; role: "annotator" | "reviewer" | "admin"; status: "pending" | "active" | "blocked"; joined: string; owner?: boolean }
export interface Overview {
  folders: Root[];
  users: Person[];
  project: Project;
  drive: { connected: boolean; account: { email: string; name: string } | null };
  updated: string;
}
