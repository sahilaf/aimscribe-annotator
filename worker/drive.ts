// Google Drive as the project owner. The Worker holds the owner's refresh token (a Cloudflare
// secret), swaps it for short-lived access tokens, and is the only thing that talks to Drive.
// Annotators never receive a Drive token.
import type { Env } from "./env";

export interface Entry {
  id: string;
  name: string;
  mimeType: string;
  parent?: string;
  parents?: string[];
  size?: string;
  modifiedTime?: string;
  properties?: Record<string, string>;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
  shortcutDetails?: { targetId: string; targetMimeType: string };
  driveId?: string;
  trashed?: boolean;
}

export interface Drive {
  account(): Promise<{ email: string; name: string }>;
  meta(fileId: string): Promise<Entry>;
  children(folderIds: string[], driveId?: string | null): Promise<Entry[]>;
  findByName(name: string, parentId: string | null): Promise<Entry[]>;
  media(fileId: string, range?: string | null): Promise<Response>;
  text(fileId: string): Promise<string>;
  createFolder(name: string, parentId: string): Promise<string>;
  createJson(parentId: string, name: string, content: string, properties: Record<string, string | null>): Promise<Entry>;
  updateJson(fileId: string, content: string, properties: Record<string, string | null>): Promise<Entry>;
}

export class DriveError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

const API = "https://www.googleapis.com/drive/v3/";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS = "id,name,mimeType,size,modifiedTime,parents,properties,driveId,shortcutDetails,trashed,lastModifyingUser(displayName,emailAddress)";
const FOLDER = "application/vnd.google-apps.folder";

// One access token per Worker instance, refreshed a minute before it expires.
let cached = { token: "", exp: 0, rt: "" };

export class GoogleDrive implements Drive {
  constructor(private env: Env) {}

  private async token() {
    const rt = this.env.DRIVE_REFRESH_TOKEN;
    if (!rt) throw new DriveError("drive_not_connected", "Drive is not connected yet. The admin connects it in Settings.", 503);
    if (cached.token && cached.rt === rt && Date.now() < cached.exp) return cached.token;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET || "", refresh_token: rt, grant_type: "refresh_token" }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new DriveError("drive_token_invalid", `Google refused the stored Drive key (${body.error || res.status}). Reconnect Drive in Settings.`, 503);
    }
    cached = { token: body.access_token, exp: Date.now() + ((body.expires_in || 3600) - 60) * 1000, rt };
    return cached.token;
  }

  private async req(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    const token = await this.token();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && attempt < 1) {
      cached.token = "";
      return this.req(url, init, attempt + 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      return this.req(url, init, attempt + 1);
    }
    if (!res.ok && res.status !== 206) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new DriveError(res.status === 404 ? "not_found" : "drive_error", body.error?.message || `Drive ${res.status}`, res.status === 404 ? 404 : 502);
    }
    return res;
  }

  private async api<T>(path: string, query: Record<string, string> = {}, init: RequestInit = {}): Promise<T> {
    const q = new URLSearchParams({ supportsAllDrives: "true", ...query });
    const res = await this.req(`${API}${path}?${q}`, init);
    return res.json() as Promise<T>;
  }

  async account() {
    const r = await this.api<{ user: { emailAddress: string; displayName: string } }>("about", { fields: "user(emailAddress,displayName)" });
    return { email: r.user.emailAddress, name: r.user.displayName };
  }

  meta(fileId: string) {
    return this.api<Entry>(`files/${fileId}`, { fields: FIELDS });
  }

  async children(ids: string[], driveId?: string | null) {
    const out: Entry[] = [];
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const q = `(${chunk.map((id) => `'${id}' in parents`).join(" or ")}) and trashed = false`;
      let pageToken: string | undefined;
      do {
        const query: Record<string, string> = { q, fields: `nextPageToken,files(${FIELDS})`, pageSize: "1000", includeItemsFromAllDrives: "true" };
        if (driveId) Object.assign(query, { corpora: "drive", driveId });
        if (pageToken) query.pageToken = pageToken;
        const r = await this.api<{ files: Entry[]; nextPageToken?: string }>("files", query);
        for (const f of r.files) out.push({ ...f, parent: (f.parents || []).find((p) => chunk.includes(p)) || f.parents?.[0] });
        pageToken = r.nextPageToken;
      } while (pageToken);
    }
    return out;
  }

  async findByName(name: string, parentId: string | null) {
    const n = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = `name = '${n}' and trashed = false and ` + (parentId ? `'${parentId}' in parents` : "'me' in owners");
    const r = await this.api<{ files: Entry[] }>("files", { q, fields: `files(${FIELDS})`, includeItemsFromAllDrives: "true" });
    return r.files;
  }

  media(fileId: string, range?: string | null) {
    return this.req(`${API}files/${fileId}?alt=media&supportsAllDrives=true`, range ? { headers: { Range: range } } : {});
  }

  async text(fileId: string) {
    return (await this.media(fileId)).text();
  }

  async createFolder(name: string, parentId: string) {
    const r = await this.api<{ id: string }>("files", { fields: "id" }, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
    return r.id;
  }

  private async upload(method: string, url: string, metadata: object, content: string) {
    const boundary = "aimscribe" + crypto.randomUUID().replace(/-/g, "");
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.req(url, { method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    return res.json() as Promise<Entry>;
  }

  createJson(parentId: string, name: string, content: string, properties: Record<string, string | null>) {
    const props = Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== "" && v != null));
    return this.upload("POST", `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`,
      { name, parents: [parentId], mimeType: "application/json", properties: props }, content);
  }

  updateJson(fileId: string, content: string, properties: Record<string, string | null>) {
    const props = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v === "" ? null : v]));
    return this.upload("PATCH", `${UPLOAD}/${fileId}?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, { properties: props }, content);
  }
}
