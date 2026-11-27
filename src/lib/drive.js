// Google sign-in (Google Identity Services token flow) and the Drive v3 calls the app needs.
// Runs entirely in the browser: the access token lives in memory only, and the only servers
// contacted are Google's. Every annotator sees exactly what Drive sharing gives them.
import { buildProject, FOLDER, SHORTCUT, SKIP_DIRS, isPrivate, OUTPUT_DIR } from "./project.js";
import { readWithProgress } from "./audio.js";
import { sleep } from "./util.js";

// Full Drive scope: annotators must read drafts and audio in folders shared with them and write
// into corrected/ folders the app did not create. drive.file cannot see either.
const SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3/";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const ENTRY_FIELDS = "id,name,mimeType,size,modifiedTime,parents,properties,driveId,shortcutDetails,lastModifyingUser(displayName,emailAddress)";
const MAX_DEPTH = 4;

export class AuthError extends Error {}

/** Folder link or bare id -> id. Accepts drive.google.com/drive/folders/ID, ?id=ID, /u/0/... */
export function folderIdFrom(input) {
  const s = String(input || "").trim();
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

function waitForGis(ms = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error("Google sign-in did not load. Check the connection, or an ad blocker blocking accounts.google.com."));
      setTimeout(poll, 100);
    })();
  });
}

export class DriveStore {
  constructor(clientId) {
    this.kind = "drive";
    this.clientId = clientId;
    this.token = null;
    this.expiresAt = 0;
    this.user = null;
    this.onAuthNeeded = null; // set by the app: () => Promise that resolves once the user reconnects
    this._pending = null;
  }

  async init() {
    await waitForGis();
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPE,
      callback: (resp) => this._pending?.resolve(resp),
      error_callback: (err) => this._pending?.reject(err),
    });
  }

  /** Must be called from a click or tap: Google opens a popup. */
  signIn(firstTime = true) {
    return new Promise((resolve, reject) => {
      this._pending = {
        resolve: async (resp) => {
          this._pending = null;
          if (resp.error) return reject(new Error(resp.error_description || resp.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
            return reject(new Error("Drive access was not granted. Sign in again and tick the Google Drive box."));
          }
          this.token = resp.access_token;
          this.expiresAt = Date.now() + (resp.expires_in - 60) * 1000;
          try {
            if (!this.user) {
              const about = await this.api("about", { query: { fields: "user(displayName,emailAddress,photoLink)" } });
              this.user = { email: about.user.emailAddress, name: about.user.displayName || about.user.emailAddress, photo: about.user.photoLink };
              localStorage.setItem("aimscribe:hint", this.user.email);
            }
            resolve(this.user);
          } catch (e) { reject(e); }
        },
        reject: (err) => {
          this._pending = null;
          const why = err?.type === "popup_failed_to_open" ? "The sign-in popup was blocked. Allow popups for this site and try again."
            : err?.type === "popup_closed" ? "The sign-in window was closed before finishing." : err?.message || String(err?.type || err);
          reject(new AuthError(why));
        },
      };
      const hint = this.user?.email || localStorage.getItem("aimscribe:hint") || undefined;
      this.client.requestAccessToken({ prompt: firstTime && !hint ? "select_account" : "", login_hint: hint });
    });
  }

  signOut() {
    if (this.token) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null;
    this.user = null;
  }

  async ensureToken() {
    if (this.token && Date.now() < this.expiresAt) return;
    if (!this.onAuthNeeded) throw new AuthError("Not signed in");
    await this.onAuthNeeded();
  }

  /** fetch with the token, retries on rate limits and 5xx, one reconnect on 401. */
  async request(url, opts = {}, attempt = 0) {
    await this.ensureToken();
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${this.token}` } });
    if (res.status === 401 && attempt < 1) {
      this.token = null;
      return this.request(url, opts, attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 4) {
      let retry = res.status !== 403;
      if (!retry) {
        const body = await res.clone().json().catch(() => ({}));
        retry = /rate/i.test(body?.error?.errors?.[0]?.reason || "");
      }
      if (retry) {
        await sleep(800 * 2 ** attempt + Math.random() * 300);
        return this.request(url, opts, attempt + 1);
      }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message || `${res.status} ${res.statusText}`;
      const err = new Error(res.status === 404 ? `Not found on Drive, or not shared with you (${msg})` : `Drive: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async api(path, { method = "GET", query = {}, body } = {}) {
    const q = new URLSearchParams({ supportsAllDrives: "true", ...query });
    const res = await this.request(`${API}${path}?${q}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.status === 204 ? null : res.json();
  }

  async resolveFolder(input) {
    const id = folderIdFrom(input);
    if (!id) throw new Error("That does not look like a Google Drive folder link.");
    const f = await this.api(`files/${id}`, { query: { fields: "id,name,mimeType,driveId,shortcutDetails" } });
    if (f.mimeType === SHORTCUT && f.shortcutDetails?.targetMimeType === FOLDER) return this.resolveFolder(f.shortcutDetails.targetId);
    if (f.mimeType !== FOLDER) throw new Error(`"${f.name}" is a file, not a folder.`);
    return { id: f.id, name: f.name, driveId: f.driveId || null };
  }

  async listChildren(ids, driveId) {
    const out = [];
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const q = `(${chunk.map((id) => `'${id}' in parents`).join(" or ")}) and trashed = false`;
      let pageToken;
      do {
        const query = { q, fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: "1000", includeItemsFromAllDrives: "true" };
        if (driveId) Object.assign(query, { corpora: "drive", driveId });
        if (pageToken) query.pageToken = pageToken;
        const r = await this.api("files", { query });
        for (const f of r.files) out.push({ ...f, parent: (f.parents || []).find((p) => chunk.includes(p)) || f.parents?.[0] });
        pageToken = r.nextPageToken;
      } while (pageToken);
    }
    return out;
  }

  /** Walk each root folder breadth-first (one request per level per 25 folders). */
  async listProject(roots, onProgress) {
    const entries = [];
    const seen = new Set(roots.map((r) => r.id));
    for (const root of roots) {
      let level = [root.id];
      for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
        onProgress?.(`Reading ${root.name}: level ${depth + 1}, ${entries.length} files so far`);
        const kids = await this.listChildren(level, root.driveId);
        const next = [];
        for (let f of kids) {
          if (f.mimeType === SHORTCUT && f.shortcutDetails) {
            f = { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, size: undefined };
          }
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
    return buildProject(entries, roots);
  }

  async getText(fileId) {
    const res = await this.request(`${API}files/${fileId}?alt=media&supportsAllDrives=true`);
    return res.text();
  }

  async getAudio(fileId, size, onProgress) {
    const res = await this.request(`${API}files/${fileId}?alt=media&supportsAllDrives=true`);
    return readWithProgress(res, size, onProgress);
  }

  async getProps(fileId) {
    const f = await this.api(`files/${fileId}`, { query: { fields: "id,properties,modifiedTime,lastModifyingUser(displayName,emailAddress),trashed" } });
    return { properties: f.properties || {}, modifiedTime: f.modifiedTime, lastBy: f.lastModifyingUser?.displayName || f.lastModifyingUser?.emailAddress || "", trashed: f.trashed };
  }

  async findByName(folderId, name) {
    const q = `'${folderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    const r = await this.api("files", { query: { q, fields: "files(id,properties,modifiedTime)", includeItemsFromAllDrives: "true" } });
    return r.files[0] || null;
  }

  async ensureOutputFolder(set) {
    if (set.outputFolderIds.length) return set.outputFolderIds[0];
    const q = `'${set.id}' in parents and name = '${OUTPUT_DIR}' and mimeType = '${FOLDER}' and trashed = false`;
    const r = await this.api("files", { query: { q, fields: "files(id)", includeItemsFromAllDrives: "true" } });
    const id = r.files[0]?.id || (await this.api("files", { method: "POST", query: { fields: "id" }, body: { name: OUTPUT_DIR, mimeType: FOLDER, parents: [set.id] } })).id;
    set.outputFolderIds.push(id);
    return id;
  }

  async upload(method, url, metadata, content) {
    const boundary = "aimscribe" + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.request(url, { method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    return res.json();
  }

  // Empty property values are left out on create and cleared (null) on update.
  createJson(folderId, name, content, properties) {
    const props = Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== "" && v != null));
    return this.upload("POST", `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,modifiedTime`,
      { name, parents: [folderId], mimeType: "application/json", properties: props }, content);
  }

  updateJson(fileId, content, properties) {
    const props = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v === "" ? null : v]));
    return this.upload("PATCH", `${UPLOAD}/${fileId}?uploadType=multipart&supportsAllDrives=true&fields=id,modifiedTime`,
      { properties: props }, content);
  }
}
