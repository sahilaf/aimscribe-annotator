import { useState } from "react";
import { CheckCircle2, CircleDashed, ExternalLink, FolderOpen, HardDrive, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoLabel } from "@/components/bits";
import { api, useSession, loadOverview, refreshMe } from "@/state/session";
import { confirm } from "@/state/dialogs";
import { cn } from "@/lib/utils";

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0"><p className={cn("font-medium", done && "text-muted-foreground")}>{title}</p>{children && <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>}</div>
    </div>
  );
}

export function SettingsTab() {
  const { me, overview } = useSession();
  const connected = me?.drive.connected !== false;
  const account = overview?.drive.account;
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  const addFolder = async () => {
    if (!link.trim()) return;
    setBusy(true);
    try { await api!.folder({ add: link.trim() }); setLink(""); await loadOverview(true); toast.success("Folder added"); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="grid gap-6">
      <div>
        <MonoLabel>Project</MonoLabel>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">Settings</h1>
      </div>

      <section className="rounded-3xl border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary"><HardDrive className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold tracking-tight">Google Drive</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {connected ? <>Connected{account ? <> as <span className="font-mono text-foreground">{account.email}</span></> : ""}. Audio, drafts and every annotation stay in this Drive; teammates never get access to it.</>
                : "Connect your Drive once. The app then reads audio and drafts and saves the team's work into it for them."}
            </p>
          </div>
        </div>
        {!connected ? (
          <div className="mt-6 grid gap-4 rounded-2xl bg-secondary/60 p-5">
            <Step done={false} title="1. Connect Drive">
              Opens Google. Choose your account and tick the Google Drive box.
              <div className="mt-3"><Button variant="ink" asChild><a href="/api/admin/drive/connect"><HardDrive /> Connect Drive</a></Button></div>
            </Step>
            <Step done={false} title="2. Save the key in Cloudflare">
              The next page shows a key. Add it in Cloudflare → Workers &amp; Pages → aimscribe-annotator → Settings → Variables and Secrets, as a <b>Secret</b> named <code className="font-mono">DRIVE_REFRESH_TOKEN</code>.
            </Step>
            <Step done={false} title="3. Come back and check">
              <div className="mt-2"><Button variant="outline" onClick={refreshMe}>I’ve saved it: check again</Button></div>
            </Step>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" asChild><a href="/api/admin/drive/connect">Reconnect Drive</a></Button>
            <Button variant="ghost" asChild><a href="https://drive.google.com" target="_blank" rel="noreferrer">Open Drive <ExternalLink /></a></Button>
          </div>
        )}
      </section>

      <section className={cn("rounded-3xl border bg-card p-5 shadow-soft sm:p-6", !connected && "pointer-events-none opacity-50")}>
        <p className="text-lg font-semibold tracking-tight">Set folders</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The folders with <code className="font-mono">audio16k/</code> and drafts, e.g. test_set, dev_set, train_set. Keep <code className="font-mono">PRIVATE_id_map.json</code> files out of them.
        </p>
        <div className="mt-4 overflow-hidden rounded-2xl border">
          {(overview?.folders || []).map((f, i) => (
            <div key={f.id} className={cn("flex items-center gap-3 px-4 py-3", i && "border-t")}>
              <FolderOpen className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {overview?.project.sets.filter((s) => s.id === f.id || s.name.startsWith(f.name + "/")).reduce((n, s) => n + s.items.length, 0) ?? 0} recordings
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${f.name}`} onClick={async () => {
                if (!(await confirm("Remove this folder from the app?", "Nothing is deleted in Drive. Its files and assignments disappear from the dashboard until you add it again.", "Remove"))) return;
                await api!.folder({ remove: f.id }).catch((e) => toast.error(e.message));
                loadOverview(true);
              }}><Trash2 /></Button>
            </div>
          ))}
          {!overview?.folders.length && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No folders yet.</p>}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addFolder(); }}>
          <Input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="Paste a Google Drive folder link" className="h-11 flex-1 rounded-full px-4" />
          <Button type="submit" variant="ink" className="h-11" disabled={busy}><Plus /> Add</Button>
        </form>
      </section>

      <section className="rounded-3xl border bg-card p-5 shadow-soft sm:p-6">
        <p className="text-lg font-semibold tracking-tight">Letting anyone sign in</p>
        <div className="mt-4 grid gap-4">
          <Step done={false} title="Publish the Google sign-in app">
            Google Cloud → Google Auth Platform → Audience → <b>Publish app</b>. Teammates only share their email with the app, so no Google review is needed for them.
          </Step>
          <Step done={false} title="Add the Drive callback address">
            Google Cloud → Clients → your client → Authorized redirect URIs: <code className="break-all font-mono">{location.origin}/api/admin/drive/callback</code>
          </Step>
          <Step done={!!me?.isAdmin} title="Admins">
            Admins are the emails in the Cloudflare secret <code className="font-mono">ADMIN_EMAILS</code>. You can make others admins in People.
          </Step>
        </div>
      </section>
    </div>
  );
}
