// Who is signed in, which Drive folders are open, and the file list.
import { create } from "zustand";
import { toast } from "sonner";
import { DriveStore, folderIdFrom } from "@/lib/drive.js";
import { DemoStore } from "@/lib/demo.js";
import { ask } from "./dialogs";
import type { Item, Project, Root, Store, User } from "@/editor/types";

declare global {
  interface Window { AIMSCRIBE_CONFIG?: { clientId?: string } }
}

export const CLIENT_ID: string = window.AIMSCRIBE_CONFIG?.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

type Screen = "signin" | "home" | "editor";

interface SessionState {
  screen: Screen;
  store: Store | null;
  user: User | null;
  roots: Root[];
  project: Project | null;
  setId: string;
  listing: string | null; // progress message while reading folders
  listError: string | null;
  driveReady: boolean;
  signinError: string;
  pendingRoots: string[] | null;
  loading: { text: string; progress: number | null } | null;
  openFor: Item | null; // file waiting for the "how to open" choice
}

export const useSession = create<SessionState>(() => ({
  screen: "signin",
  store: null,
  user: null,
  roots: [],
  project: null,
  setId: localStorage.getItem("aimscribe:set") || "",
  listing: null,
  listError: null,
  driveReady: false,
  signinError: "",
  pendingRoots: null,
  loading: null,
  openFor: null,
}));

const set = useSession.setState;
const get = useSession.getState;

// A team link (#p=id1,id2) opens those folders after sign-in.
{
  const hash = new URLSearchParams(location.hash.slice(1));
  const p = hash.get("p");
  if (p) {
    set({ pendingRoots: p.split(",").map(folderIdFrom).filter(Boolean) as string[] });
    history.replaceState(null, "", location.pathname + location.search);
  }
}

// Load Google sign-in now, so a tap on Sign in opens Google's popup at once: iOS Safari blocks
// popups that open after waiting on anything.
export const drive: Store | null = CLIENT_ID ? (new DriveStore(CLIENT_ID) as unknown as Store) : null;
drive?.init().then(() => set({ driveReady: true }), (e: Error) => set({ signinError: e.message }));

export async function signIn(demo: boolean) {
  set({ signinError: "" });
  try {
    let store: Store;
    if (demo) store = new DemoStore() as unknown as Store;
    else {
      if (!drive || !get().driveReady) throw new Error("Google sign-in is still loading. Try again in a moment.");
      store = drive;
    }
    store.onAuthNeeded = reconnect;
    const user = await store.signIn(true); // nothing awaited before this: the popup must open inside the tap
    let roots: Root[];
    if (demo) roots = [{ id: "demo-root", name: "demo_project" }];
    else {
      roots = JSON.parse(localStorage.getItem("aimscribe:roots") || "[]");
      for (const id of get().pendingRoots || []) if (!roots.some((r) => r.id === id)) roots.push({ id, name: id, unresolved: true });
    }
    set({ store, user, roots, pendingRoots: null, screen: "home", project: null });
    loadProject();
  } catch (e) {
    console.error(e);
    set({ signinError: (e as Error).message || String(e) });
  }
}

export function signOut() {
  get().store?.signOut();
  set({ store: null, user: null, project: null, screen: "signin" });
}

let reconnecting: Promise<void> | null = null;
/** The 1-hour Google token ran out. Reconnecting needs a tap, because Google opens a popup. */
function reconnect(): Promise<void> {
  if (reconnecting) return reconnecting;
  reconnecting = ask("Google session expired", "Your work is kept on this device. Reconnect to carry on saving to Drive.", [
    { label: "Not now", value: false, variant: "ghost" },
    {
      label: "Reconnect", variant: "ink",
      run: () => get().store!.signIn(false).then(() => true, (e: Error) => { toast.error(e.message); return false; }),
    },
  ]).then((v) => {
    if (v === false || v === null) throw new Error("Not reconnected: changes are kept on this device only");
  }).finally(() => { reconnecting = null; });
  return reconnecting;
}

// Warn five minutes before the Google token ends; the button refreshes it inside the tap.
let warnedFor = 0;
setInterval(() => {
  const st = get().store;
  if (!st || st.kind !== "drive" || !st.token || warnedFor === st.expiresAt) return;
  if (st.expiresAt - Date.now() < 5 * 60e3) {
    warnedFor = st.expiresAt;
    toast("Google sign-in ends in 5 minutes", {
      duration: 5 * 60e3,
      action: { label: "Stay signed in", onClick: () => { st.signIn(false).then(() => toast.success("Signed in for another hour"), (e: Error) => toast.error(e.message)); } },
    });
  }
}, 30e3);

function saveRoots() {
  if (get().store?.kind === "drive") {
    localStorage.setItem("aimscribe:roots", JSON.stringify(get().roots.filter((r) => !r.unresolved).map(({ id, name, driveId }) => ({ id, name, driveId }))));
  }
}

export async function addFolder(input: string) {
  const store = get().store!;
  const r = await store.resolveFolder(input);
  if (!get().roots.some((x) => x.id === r.id)) set({ roots: [...get().roots, r] });
  saveRoots();
  await loadProject();
}

export function removeFolder(id: string) {
  set({ roots: get().roots.filter((r) => r.id !== id) });
  saveRoots();
  loadProject();
}

export async function loadProject(quiet = false) {
  const store = get().store;
  if (!store) return;
  if (!get().roots.length) return set({ project: null, listing: null });
  if (!quiet) set({ listing: "Reading folders from Drive…", listError: null });
  try {
    const roots = [...get().roots];
    for (const r of roots) {
      if (!r.unresolved) continue;
      try { Object.assign(r, await store.resolveFolder(r.id), { unresolved: false }); }
      catch (e) { toast.error(`A shared folder could not be opened: ${(e as Error).message}`); }
    }
    set({ roots: roots.filter((r) => !r.unresolved) });
    saveRoots();
    const project = await store.listProject(get().roots, (msg) => { if (!quiet) set({ listing: msg }); });
    const setId = project.sets.some((s) => s.id === get().setId) ? get().setId : project.sets[0]?.id || "";
    set({ project, setId, listing: null });
  } catch (e) {
    console.error(e);
    set({ listing: null, listError: (e as Error).message });
  }
}

export function selectSet(id: string) {
  localStorage.setItem("aimscribe:set", id);
  set({ setId: id });
}

export async function copyTeamLink() {
  const roots = get().roots;
  if (!roots.length) return toast("Add a folder first");
  const url = `${location.origin}${location.pathname}#p=${roots.map((r) => r.id).join(",")}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Team link copied", { description: "Teammates also need the folders shared with them on Drive." });
  } catch {
    ask("Team link", url, [{ label: "Close", value: null }]);
  }
}
