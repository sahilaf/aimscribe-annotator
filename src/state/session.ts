// Who is signed in, what they see, and the file list.
// Real use: ApiStore (the Worker backend holds the owner's Drive; teammates sign in for identity only).
// Training: DemoStore (made-up files in this browser).
import { create } from "zustand";
import { toast } from "sonner";
import { ApiStore, type Me, type Overview } from "@/lib/api";
import { DemoStore } from "@/lib/demo.js";
import { ask } from "./dialogs";
import type { Item, Project, Root, Store, User } from "@/editor/types";

declare global {
  interface Window { AIMSCRIBE_CONFIG?: { clientId?: string } }
}

export const CLIENT_ID: string = window.AIMSCRIBE_CONFIG?.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

export type Screen = "loading" | "signin" | "waiting" | "home" | "admin" | "editor";

interface SessionState {
  screen: Screen;
  returnTo: "home" | "admin";
  store: Store | null;
  me: Me | null;
  user: User | null;
  roots: Root[];
  project: Project | null;
  overview: Overview | null;
  setId: string;
  listing: string | null;
  listError: string | null;
  apiReady: boolean;
  backendDemo: boolean; // local test backend: sign in by typing an email
  signinError: string;
  loading: { text: string; progress: number | null } | null;
  openFor: Item | null;
}

export const useSession = create<SessionState>(() => ({
  screen: "loading",
  returnTo: "home",
  store: null,
  me: null,
  user: null,
  roots: [],
  project: null,
  overview: null,
  setId: localStorage.getItem("aimscribe:set") || "",
  listing: null,
  listError: null,
  apiReady: false,
  backendDemo: false,
  signinError: "",
  loading: null,
  openFor: null,
}));

const set = useSession.setState;
const get = useSession.getState;

// Old team links (#p=…) are no longer needed: everyone just opens the site.
if (location.hash.startsWith("#p=")) history.replaceState(null, "", location.pathname + location.search);

export const api: ApiStore | null = CLIENT_ID ? new ApiStore(CLIENT_ID) : null;

/** On page load: an existing session skips the sign-in screen. */
async function boot() {
  const cfg = await fetch("/api/config").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  set({ backendDemo: !!cfg?.demo });
  if (api) {
    api.onAuthNeeded = reconnect;
    api.init().then(() => set({ apiReady: true }), (e: Error) => set({ signinError: e.message }));
    const me = cfg ? await api.restore() : null;
    if (me) return enter(me);
  }
  set({ screen: "signin" });
}
boot();

function enter(me: Me) {
  set({ store: api, me, user: api!.user, signinError: "" });
  if (me.status === "blocked") return set({ screen: "signin", signinError: "Your access to this project was removed. Contact the project lead." });
  if (me.isAdmin) return set({ screen: "admin", returnTo: "admin" });
  if (me.status !== "active") return set({ screen: "waiting" });
  set({ screen: "home", returnTo: "home" });
  loadProject();
}

export async function signIn() {
  set({ signinError: "" });
  try {
    if (!api || !get().apiReady) throw new Error("Google sign-in is still loading. Try again in a moment.");
    await api.signIn(); // nothing awaited before this: the popup must open inside the tap
    enter(api.me!);
  } catch (e) {
    console.error(e);
    set({ signinError: (e as Error).message || String(e) });
  }
}

export async function devSignIn(email: string) {
  try {
    await api!.devSignIn(email);
    enter(api!.me!);
  } catch (e) {
    set({ signinError: (e as Error).message });
  }
}

export async function startDemo() {
  const store = new DemoStore() as unknown as Store;
  const user = await store.signIn(true);
  set({ store, user, me: null, roots: [{ id: "demo-root", name: "demo_project" }], screen: "home", returnTo: "home", project: null });
  loadProject();
}

export function signOut() {
  get().store?.signOut();
  set({ store: null, user: null, me: null, project: null, overview: null, screen: "signin" });
}

/** Re-check access (the waiting screen polls this). */
export async function refreshMe() {
  if (!api) return;
  const me = await api.restore();
  if (me) enter(me);
  else set({ screen: "signin" });
}

let reconnecting: Promise<void> | null = null;
/** The session cookie ran out (14 days). Signing in again needs a tap: Google opens a popup. */
function reconnect(): Promise<void> {
  if (reconnecting) return reconnecting;
  reconnecting = ask("Please sign in again", "Your work is kept on this device. Sign in to carry on saving.", [
    { label: "Not now", value: false, variant: "ghost" },
    { label: "Sign in", variant: "ink", run: () => api!.signIn().then(() => true, (e: Error) => { toast.error(e.message); return false; }) },
  ]).then((v) => {
    if (v === false || v === null) throw new Error("Not signed in: changes are kept on this device only");
  }).finally(() => { reconnecting = null; });
  return reconnecting;
}

export async function loadProject(quiet = false) {
  const store = get().store;
  if (!store) return;
  if (!quiet) set({ listing: "Loading your files…", listError: null });
  try {
    const project = await store.listProject(get().roots, (msg) => { if (!quiet) set({ listing: msg }); });
    const setId = project.sets.some((s) => s.id === get().setId) ? get().setId : project.sets[0]?.id || "";
    set({ project, setId, listing: null });
  } catch (e) {
    console.error(e);
    set({ listing: null, listError: (e as Error).message });
  }
}

/** Admin: everything, with assignments. Also becomes the project the editor opens files from. */
export async function loadOverview(fresh = false) {
  if (!api) return;
  try {
    const overview = await api.overview(fresh);
    const setId = overview.project.sets.some((s) => s.id === get().setId) ? get().setId : overview.project.sets[0]?.id || "";
    set({ overview, project: overview.project, setId, listError: null });
  } catch (e) {
    set({ listError: (e as Error).message });
  }
}

export function selectSet(id: string) {
  localStorage.setItem("aimscribe:set", id);
  set({ setId: id });
}

export async function copyInviteLink() {
  const url = `${location.origin}${location.pathname}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied", { description: "Anyone can sign up. They see files only after you assign them." });
  } catch {
    ask("Invite link", url, [{ label: "Close", value: null }]);
  }
}
