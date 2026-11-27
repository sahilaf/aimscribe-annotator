// AIMScribe Annotator backend (Cloudflare Worker). Serves the built site, and under /api:
// sign-in, the annotator's task list, audio and drafts streamed from the owner's Drive, saving
// annotations into the owner's Drive, and the admin dashboard's data and actions.
//
// Access rule, checked on every file request: a person reaches a file only if it is assigned to
// them (to annotate or to review), or they are an admin. Annotators never see another
// annotator's work on the same file unless they are its reviewer (keeps double annotation blind).
import type { Env } from "./env";
import { GoogleDrive, DriveError, type Drive, type Entry } from "./drive";
import { FakeDrive } from "./fake-drive";
import { readSession, makeCookie, clearCookie, verifyGoogleToken, sign, verifySig, type Session } from "./auth";
import { loadState, updateState, getIndex, invalidateIndex, type State, type Role, type Status, type Indexed } from "./state";
import { annotatorTag, OUTPUT_DIR, APP_ID } from "../src/lib/project.js";
import { docProperties, SCHEMA } from "../src/lib/formats.js";
import { folderIdFrom } from "../src/lib/util.js";

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

const FOLDER = "application/vnd.google-apps.folder";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof DriveError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: "server_error", message: (e as Error).message || "Server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

const demo = (env: Env) => env.DEMO === "1";
const driveFor = (env: Env): Drive => (demo(env) ? new FakeDrive() : new GoogleDrive(env));
const adminEmails = (env: Env) =>
  (env.ADMIN_EMAILS || (demo(env) ? "admin@demo.test" : "")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const driveConnected = (env: Env) => demo(env) || !!env.DRIVE_REFRESH_TOKEN;

interface Ctx { s: Session; me: string; role: Role; status: Status; isAdmin: boolean; state: State; d: Drive; env: Env }

async function context(req: Request, env: Env, needActive = true): Promise<Ctx> {
  const s = await readSession(env, req);
  if (!s) fail(401, "signed_out", "Please sign in again");
  const d = driveFor(env);
  const { state } = await loadState(d, env);
  const me = s!.email;
  const isAdmin = adminEmails(env).includes(me) || state.users[me]?.role === "admin";
  const u = state.users[me];
  const status: Status = isAdmin ? "active" : u?.status || "pending";
  if (status === "blocked") fail(403, "blocked", "Your access to this project was removed");
  if (needActive && status !== "active") fail(403, "pending", "Waiting for the project lead to give you access");
  return { s: s!, me, role: isAdmin ? "admin" : u?.role || "annotator", status, isAdmin, state, d, env };
}

function access(c: Ctx, key: string) {
  if (c.isAdmin) return { annotate: true, review: true };
  const a = c.state.assignments[key] || [];
  return { annotate: a.some((x) => x.email === c.me && x.kind === "annotate"), review: a.some((x) => x.email === c.me && x.kind === "review") };
}

const visibleOutputs = (c: Ctx, item: any) => {
  const a = access(c, item.key);
  return item.outputs.filter((o: any) => a.review || o.annotator === c.me);
};

async function body<T>(req: Request, max = 6e6): Promise<T> {
  const len = +(req.headers.get("content-length") || 0);
  if (len > max) fail(413, "too_large", "Request too large");
  try { return (await req.json()) as T; } catch { return fail(400, "bad_json", "Expected JSON"); }
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = req.method;
  const secure = url.protocol === "https:";

  if (p === "/api/config" && m === "GET") return json({ clientId: env.GOOGLE_CLIENT_ID, demo: demo(env) });

  // ---------------------------------------------------------------- session
  if (p === "/api/session" && m === "POST") {
    const b = await body<{ accessToken?: string; devEmail?: string; devName?: string }>(req, 1e4);
    let who: { email: string; name: string; picture?: string };
    if (demo(env) && b.devEmail) who = { email: b.devEmail.trim().toLowerCase(), name: b.devName || b.devEmail.split("@")[0] };
    else if (b.accessToken) who = await verifyGoogleToken(env, b.accessToken).catch((e) => fail(401, "google_rejected", e.message));
    else return fail(400, "no_token", "Missing sign-in token");
    return json({ ok: true }, 200, { "Set-Cookie": await makeCookie(env, who, secure) });
  }
  if (p === "/api/logout" && m === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearCookie(secure) });

  if (p === "/api/me" && m === "GET") {
    const s = await readSession(env, req);
    if (!s) return fail(401, "signed_out", "Not signed in");
    const isEnvAdmin = adminEmails(env).includes(s.email);
    const base = { email: s.email, name: s.name, picture: s.picture, demo: demo(env), noAdmin: adminEmails(env).length === 0 };
    if (!driveConnected(env)) {
      return json({ ...base, role: isEnvAdmin ? "admin" : "annotator", status: isEnvAdmin ? "active" : "pending", isAdmin: isEnvAdmin, drive: { connected: false } });
    }
    const d = driveFor(env);
    let { state } = await loadState(d, env);
    const known = state.users[s.email];
    if (!isEnvAdmin && !known) {
      state = await updateState(d, env, (st) => {
        st.users[s.email] ||= { name: s.name, picture: s.picture, role: "annotator", status: "pending", joined: new Date().toISOString() };
      });
    } else if (known && known.name === s.email && s.name && s.name !== s.email) {
      // added by email before they signed in: take their Google name now
      state = await updateState(d, env, (st) => { if (st.users[s.email]) st.users[s.email].name = s.name; });
    }
    const u = state.users[s.email];
    const isAdmin = isEnvAdmin || u?.role === "admin";
    return json({ ...base, role: isAdmin ? "admin" : u.role, status: isAdmin ? "active" : u.status, isAdmin, drive: { connected: true } });
  }

  // ---------------------------------------------------------------- admin: Drive connection (one time)
  if (p === "/api/admin/drive/connect" && m === "GET") {
    const c = await adminOnly(req, env);
    if (demo(env)) return Response.redirect(`${url.origin}/?drive=demo`, 302);
    const data = btoa(JSON.stringify({ e: c.email, x: Date.now() + 10 * 60e3 }));
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/api/admin/drive/callback`, response_type: "code",
      scope: `openid email ${DRIVE_SCOPE}`, access_type: "offline", prompt: "consent", login_hint: c.email,
      state: `${data}.${await sign(env, data)}`,
    });
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
  }
  if (p === "/api/admin/drive/callback" && m === "GET") return driveCallback(req, env, url);

  // ---------------------------------------------------------------- everything below needs Drive
  if (!driveConnected(env)) fail(503, "drive_not_connected", "The project lead has not connected Drive yet");

  // ---------------------------------------------------------------- annotator
  if (p === "/api/tasks" && m === "GET") {
    const c = await context(req, env);
    const idx = await getIndex(c.d, c.state.folders);
    const sets = idx.project.sets.map((set: any) => ({
      ...set,
      items: set.items.filter((it: any) => { const a = access(c, it.key); return a.annotate || a.review; })
        .map((it: any) => ({ ...it, outputs: visibleOutputs(c, it), access: access(c, it.key) })),
    })).filter((s: any) => s.items.length);
    return json({ sets, count: sets.reduce((n: number, s: any) => n + s.items.length, 0) });
  }

  let fm = p.match(/^\/api\/file\/([\w-]+)\/(media|text|props)$/);
  if (fm && m === "GET") {
    const c = await context(req, env);
    const idx = await getIndex(c.d, c.state.folders);
    await fileAccess(c, idx, fm[1]);
    if (fm[2] === "media") {
      const r = await c.d.media(fm[1], req.headers.get("Range"));
      const h = new Headers({ "Cache-Control": "private, no-store" });
      for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) { const v = r.headers.get(k); if (v) h.set(k, v); }
      return new Response(r.body, { status: r.status, headers: h });
    }
    if (fm[2] === "text") return new Response(await c.d.text(fm[1]), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    const meta = await c.d.meta(fm[1]);
    return json({ properties: meta.properties || {}, modifiedTime: meta.modifiedTime, lastBy: meta.properties?.lastby || meta.lastModifyingUser?.displayName || "", trashed: !!meta.trashed });
  }

  if (p === "/api/find" && m === "GET") {
    const c = await context(req, env);
    const idx = await getIndex(c.d, c.state.folders);
    const folder = url.searchParams.get("folder") || "", name = url.searchParams.get("name") || "";
    const set = await outputSet(c, idx, folder);
    const { item } = ownTarget(c, idx, set, name);
    if (!item) fail(403, "forbidden", "Not your file");
    const hit = (await c.d.findByName(name, folder))[0];
    return json(hit ? { id: hit.id, properties: hit.properties || {} } : null);
  }

  const sm = p.match(/^\/api\/sets\/([\w-]+)\/corrected$/);
  if (sm && m === "POST") {
    const c = await context(req, env);
    const idx = await getIndex(c.d, c.state.folders);
    const set = idx.sets.get(sm[1]) || fail(404, "not_found", "No such set");
    if (!set.items.some((it: any) => access(c, it.key).annotate)) fail(403, "forbidden", "No files assigned in this set");
    if (set.outputFolderIds.length) return json({ id: set.outputFolderIds[0] });
    const found = (await c.d.findByName(OUTPUT_DIR, set.id)).find((e) => e.mimeType === FOLDER);
    const id = found?.id || (await c.d.createFolder(OUTPUT_DIR, set.id));
    set.outputFolderIds.push(id);
    idx.outputFolders.set(id, set);
    return json({ id });
  }

  if (p === "/api/files" && m === "POST") {
    const c = await context(req, env);
    const idx = await getIndex(c.d, c.state.folders);
    const b = await body<{ folderId: string; name: string; content: string; properties: Record<string, string> }>(req);
    const set = await outputSet(c, idx, b.folderId);
    const { item } = ownTarget(c, idx, set, b.name);
    if (!item) fail(403, "forbidden", "This file is not assigned to you");
    const doc = checkDoc(b.content, item);
    if ((doc.annotator?.email || "").toLowerCase() !== c.me) fail(403, "forbidden", "You can only create your own annotation");
    const props = { ...docProperties(doc, b.properties?.saveid || ""), lastby: c.me };
    const saved = await c.d.createJson(b.folderId, b.name, b.content, props);
    remember(idx, item, saved, props);
    return json({ id: saved.id, modifiedTime: saved.modifiedTime });
  }

  fm = p.match(/^\/api\/files\/([\w-]+)$/);
  if (fm && m === "PUT") {
    const c = await context(req, env);
    const idx = await getIndex(c.d, c.state.folders);
    const f = await fileAccess(c, idx, fm[1]);
    if (f.kind !== "output") fail(403, "forbidden", "Only annotation files can be changed");
    const b = await body<{ content: string; properties: Record<string, string> }>(req);
    const current = await c.d.meta(fm[1]);
    const owner = (current.properties?.annotator || "").toLowerCase();
    const doc = checkDoc(b.content, f.item);
    if ((doc.annotator?.email || "").toLowerCase() !== owner) fail(403, "forbidden", "An annotation keeps its annotator");
    const props = { ...docProperties(doc, b.properties?.saveid || ""), lastby: c.me };
    const saved = await c.d.updateJson(fm[1], b.content, props);
    remember(idx, f.item, saved, props);
    return json({ id: saved.id, modifiedTime: saved.modifiedTime });
  }

  // ---------------------------------------------------------------- admin
  if (p.startsWith("/api/admin/")) {
    const c = await context(req, env);
    if (!c.isAdmin) fail(403, "forbidden", "Admins only");

    if (p === "/api/admin/overview" && m === "GET") {
      const fresh = url.searchParams.get("fresh") === "1";
      const idx = await getIndex(c.d, c.state.folders, fresh);
      const sets = idx.project.sets.map((set: any) => ({
        ...set, items: set.items.map((it: any) => ({ ...it, assigned: c.state.assignments[it.key] || [] })),
      }));
      const owners = adminEmails(env);
      const users: Record<string, unknown>[] = Object.entries(c.state.users).map(([email, u]) => ({ email, ...u, ...(owners.includes(email) ? { role: "admin", status: "active", owner: true } : {}) }));
      for (const e of owners) if (!c.state.users[e]) users.unshift({ email: e, name: e === c.me ? c.s.name : e, role: "admin", status: "active", joined: "", owner: true });
      let account: { email: string; name: string } | null = null;
      try { account = await c.d.account(); } catch { /* shown as not connected */ }
      return json({ folders: c.state.folders, users, project: { sets, count: idx.project.count }, drive: { connected: !!account, account }, updated: c.state.updated });
    }

    if (p === "/api/admin/folders" && m === "POST") {
      const b = await body<{ add?: string; remove?: string }>(req, 1e4);
      if (b.add) {
        const id = folderIdFrom(b.add) || fail(400, "bad_link", "That does not look like a Google Drive folder link");
        let f: Entry = await c.d.meta(id).catch(() => fail(404, "not_found", "Folder not found in your Drive"));
        if (f.shortcutDetails?.targetMimeType === FOLDER) f = await c.d.meta(f.shortcutDetails.targetId);
        if (f.mimeType !== FOLDER) fail(400, "not_folder", `"${f.name}" is a file, not a folder`);
        await updateState(c.d, env, (st) => { if (!st.folders.some((x) => x.id === f.id)) st.folders.push({ id: f.id, name: f.name, driveId: f.driveId || null }); });
      }
      if (b.remove) await updateState(c.d, env, (st) => { st.folders = st.folders.filter((x) => x.id !== b.remove); });
      invalidateIndex();
      return json({ ok: true });
    }

    if (p === "/api/admin/users" && m === "POST") {
      const b = await body<{ email: string; name?: string; role?: Role; status?: Status; remove?: boolean }>(req, 1e4);
      const email = (b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, "bad_email", "Enter a valid email");
      if (adminEmails(env).includes(email) && (b.role || b.status || b.remove)) fail(400, "env_admin", "This person is an admin set in Cloudflare (ADMIN_EMAILS)");
      await updateState(c.d, env, (st) => {
        if (b.remove) {
          delete st.users[email];
          for (const k of Object.keys(st.assignments)) st.assignments[k] = st.assignments[k].filter((a) => a.email !== email);
          return;
        }
        const u = (st.users[email] ||= { name: b.name || email, role: "annotator", status: "active", joined: new Date().toISOString() });
        if (b.role) u.role = b.role;
        if (b.status) u.status = b.status;
        if (b.name) u.name = b.name;
      });
      return json({ ok: true });
    }

    if (p === "/api/admin/assign" && m === "POST") {
      const b = await body<{ keys: string[]; email: string; kind: "annotate" | "review"; action: "add" | "remove" }>(req, 2e5);
      const email = (b.email || "").trim().toLowerCase();
      if (!Array.isArray(b.keys) || !b.keys.length) fail(400, "no_files", "Choose files first");
      if (b.kind !== "annotate" && b.kind !== "review") fail(400, "bad_kind", "Choose annotate or review");
      await updateState(c.d, env, (st) => {
        if (b.action === "add") {
          if (!email.includes("@")) fail(400, "bad_email", "Choose a person");
          const u = (st.users[email] ||= { name: email, role: b.kind === "review" ? "reviewer" : "annotator", status: "active", joined: new Date().toISOString() });
          if (u.status === "pending") u.status = "active"; // assigning work approves the person
          if (b.kind === "review" && u.role === "annotator") u.role = "reviewer";
        }
        for (const k of b.keys) {
          const list = (st.assignments[k] ||= []);
          if (b.action === "add") {
            if (!list.some((a) => a.email === email && a.kind === b.kind)) list.push({ email, kind: b.kind, at: new Date().toISOString(), by: c.me });
          } else {
            st.assignments[k] = list.filter((a) => !(a.kind === b.kind && (email === "*" || a.email === email)));
            if (!st.assignments[k].length) delete st.assignments[k];
          }
        }
      });
      return json({ ok: true });
    }
  }

  return fail(404, "not_found", "No such API route");
}

async function adminOnly(req: Request, env: Env) {
  const s = await readSession(env, req);
  if (!s) fail(401, "signed_out", "Sign in first");
  if (!adminEmails(env).includes(s!.email)) fail(403, "forbidden", "Only an admin listed in ADMIN_EMAILS can connect Drive");
  return s!;
}

/** Which item a file belongs to, and whether this person may open it. */
async function fileAccess(c: Ctx, idx: Indexed, fileId: string) {
  let f = idx.files.get(fileId);
  if (!f) { // an annotation saved a moment ago on another Worker instance, not yet in this index
    const meta = await c.d.meta(fileId).catch(() => null);
    const set = meta && idx.outputFolders.get(meta.parents?.[0] || meta.parent || "");
    const item = set && meta?.properties?.app === APP_ID ? idx.items.get(`${set.id}/${meta.properties.audio}`) : null;
    if (item) f = { item, kind: "output", output: { fileId, annotator: (meta!.properties!.annotator || "").toLowerCase() } };
  }
  if (!f) return fail(404, "not_found", "File not found in the project");
  const a = access(c, f.item.key);
  if (f.kind === "output") {
    const own = (f.output.annotator || "").toLowerCase() === c.me;
    if (!(a.review || (own && a.annotate))) fail(403, "forbidden", "This annotation belongs to someone else");
  } else if (!a.annotate && !a.review) fail(403, "forbidden", "This file is not assigned to you");
  return f;
}

async function outputSet(c: Ctx, idx: Indexed, folderId: string) {
  const known = idx.outputFolders.get(folderId);
  if (known) return known;
  const meta = await c.d.meta(folderId).catch(() => null);
  const set = meta && meta.name === OUTPUT_DIR ? idx.sets.get(meta.parents?.[0] || meta.parent || "") : null;
  if (!set) fail(403, "forbidden", "Not a corrected/ folder of the project");
  idx.outputFolders.set(folderId, set);
  return set;
}

/** For "<ID>__<name>.json": the item, if this person may annotate it and the name is theirs. */
function ownTarget(c: Ctx, idx: Indexed, set: any, name: string) {
  const mm = name.match(/^(.+)__([^/]+)\.json$/);
  const item = mm ? idx.items.get(`${set.id}/${mm[1]}`) : null;
  const tag = annotatorTag(c.me);
  const mine = mm && (mm[2] === tag || mm[2].startsWith(`${tag}-`));
  return { item: item && mine && access(c, item.key).annotate ? item : null };
}

function checkDoc(content: string, item: any) {
  let doc: any;
  try { doc = JSON.parse(content); } catch { fail(400, "bad_json", "Annotation is not valid JSON"); }
  if (doc.schema !== SCHEMA) fail(400, "bad_schema", "Not an annotation file");
  if (doc.audio !== item.base) fail(400, "wrong_file", "Annotation does not match this recording");
  return doc;
}

/** Keep this instance's index in step after a save, so the list and dashboard update at once. */
function remember(idx: Indexed, item: any, saved: Entry, props: Record<string, string>) {
  const summary = {
    fileId: saved.id, name: saved.name, folderId: saved.parents?.[0] || "", tag: (saved.name || "").replace(/^.*__|\.json$/g, ""),
    annotator: props.annotator, annotatorName: props.aname, status: props.status, updated: props.updated,
    checked: +props.checked || 0, total: +props.total || 0, duration: +props.dur || 0, speech: +props.speech || 0,
    spent: +props.spent || 0, reviewer: props.reviewer || "", saveid: props.saveid, lastBy: props.lastby,
  };
  const i = item.outputs.findIndex((o: any) => o.fileId === saved.id);
  if (i >= 0) item.outputs[i] = { ...item.outputs[i], ...summary };
  else item.outputs.push(summary);
  idx.files.set(saved.id, { item, kind: "output", output: summary });
}

const page = (title: string, html: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;background:#f5f4f1;color:#1c1b19;margin:0;display:grid;place-items:center;min-height:100vh;padding:20px}
main{max-width:560px;background:#fff;border:1px solid #e6e3de;border-radius:24px;padding:28px}h1{font-size:22px;margin:0 0 8px}
code,textarea{font-family:ui-monospace,monospace}textarea{width:100%;height:110px;border-radius:12px;border:1px solid #ddd;padding:10px;font-size:13px}
ol{padding-left:20px}a{color:#e0571b}.ok{color:#18864b}.err{color:#c93a3a}</style><main>${html}</main>`,
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer" } });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

async function driveCallback(req: Request, env: Env, url: URL) {
  const s = await adminOnly(req, env);
  const [data, sig] = (url.searchParams.get("state") || "").split(".");
  let st: { e: string; x: number } | null = null;
  try { st = data && sig && (await verifySig(env, data, sig)) ? JSON.parse(atob(data)) : null; } catch { st = null; }
  if (!st || st.e !== s.email || st.x < Date.now()) return page("Drive", `<h1 class="err">Link expired</h1><p>Start again from the dashboard: Settings → Connect Drive.</p>`);
  if (url.searchParams.get("error")) return page("Drive", `<h1 class="err">Not connected</h1><p>Google said: ${escapeHtml(url.searchParams.get("error") || "")}.</p><p><a href="/">Back to the dashboard</a></p>`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: `${url.origin}/api/admin/drive/callback`, grant_type: "authorization_code" }),
  });
  const t = (await res.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; scope?: string; error_description?: string; error?: string };
  if (!res.ok || !t.refresh_token) {
    return page("Drive", `<h1 class="err">Not connected</h1><p>${escapeHtml(t.error_description || t.error || "Google did not return a Drive key. Try again.")}</p><p><a href="/">Back</a></p>`);
  }
  if (!(t.scope || "").includes(DRIVE_SCOPE)) return page("Drive", `<h1 class="err">Drive box not ticked</h1><p>Start again and tick the Google Drive permission.</p><p><a href="/">Back</a></p>`);
  const who = await verifyGoogleToken(env, t.access_token || "").catch(() => ({ email: "your Google account" }));
  return page("Drive connected", `<h1 class="ok">Drive connected as ${escapeHtml(who.email)}</h1>
<p>One last step, so the app can keep using your Drive: save this key in Cloudflare.</p>
<textarea readonly onclick="this.select()">${escapeHtml(t.refresh_token)}</textarea>
<ol><li>Open Cloudflare → <b>Workers &amp; Pages</b> → <b>aimscribe-annotator</b> → <b>Settings</b> → <b>Variables and Secrets</b>.</li>
<li><b>Add</b> → Type <b>Secret</b> → Name <code>DRIVE_REFRESH_TOKEN</code> → paste the key above → <b>Deploy</b>.</li>
<li>Come back to <a href="/">the dashboard</a>. Treat this key like a password: anyone with it and your client secret can open your Drive.</li></ol>`);
}
