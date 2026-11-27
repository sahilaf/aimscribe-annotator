import { useState } from "react";
import { Ban, Check, Link2, MoreHorizontal, Trash2, UserPlus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Initials, MonoLabel } from "@/components/bits";
import { api, copyInviteLink } from "@/state/session";
import { confirm } from "@/state/dialogs";
import { fmtAgo } from "@/lib/util.js";
import { cn } from "@/lib/utils";
import type { Overview } from "@/lib/api";
import type { computeStats } from "./stats";

type Stats = ReturnType<typeof computeStats>;
const ROLE_LABEL = { annotator: "Annotator", reviewer: "Reviewer", admin: "Admin" } as const;

export function PeopleTab({ ov, stats, refresh }: { ov: Overview; stats: Stats; refresh: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("annotator");
  const change = async (c: Parameters<NonNullable<typeof api>["person"]>[0], ok?: string) => {
    try { await api!.person(c); if (ok) toast.success(ok); refresh(); } catch (e) { toast.error((e as Error).message); }
  };
  const pending = ov.users.filter((u) => u.status === "pending");
  const byEmail = new Map(stats.people.map((p) => [p.email, p]));

  return (
    <div className="grid gap-6">
      <div>
        <MonoLabel>Team</MonoLabel>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">People</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-3xl border bg-card p-5 shadow-soft">
          <p className="font-medium">Invite anyone</p>
          <p className="mt-1 text-sm text-muted-foreground">Send the link. They sign in with Google and wait here until you approve them or assign files. No Drive access is ever shared.</p>
          <Button variant="outline" className="mt-4" onClick={copyInviteLink}><Link2 /> Copy invite link</Button>
        </section>
        <section className="rounded-3xl border bg-card p-5 shadow-soft">
          <p className="font-medium">Add by email</p>
          <p className="mt-1 text-sm text-muted-foreground">Approve someone before they sign in.</p>
          <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            await change({ email: email.trim(), role, status: "active" }, `${email.trim()} can sign in now`);
            setEmail("");
          }}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@gmail.com" className="h-10 min-w-0 flex-1 rounded-full px-4" />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-10 w-32 rounded-full bg-card"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-xl">{Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="submit" variant="ink" className="h-10"><UserPlus /> Add</Button>
          </form>
        </section>
      </div>

      {pending.length > 0 && (
        <section className="rounded-3xl border border-primary/30 bg-primary/5 p-5">
          <p className="font-medium">Waiting for access <span className="font-mono text-sm text-muted-foreground">{pending.length}</span></p>
          <div className="mt-3 grid gap-2">
            {pending.map((u) => (
              <div key={u.email} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3">
                <Initials name={u.name} className="size-8 text-xs" />
                <div className="min-w-0 flex-1"><p className="font-medium">{u.name}</p><p className="truncate font-mono text-xs text-muted-foreground">{u.email} · joined {fmtAgo(u.joined)}</p></div>
                <Button variant="ghost" size="sm" onClick={() => change({ email: u.email, status: "blocked" }, "Blocked")}><Ban /> Block</Button>
                <Button variant="ink" size="sm" onClick={() => change({ email: u.email, status: "active" }, `${u.name} approved`)}><Check /> Approve</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border bg-card shadow-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {["Person", "Role", "Status", "Assigned", "Finished", "Last active", ""].map((h, i) => (
                  <TableHead key={h + i} className={cn("h-11 font-mono text-[10px] font-medium uppercase tracking-wider", i === 0 ? "pl-6" : i >= 3 && i <= 5 ? "text-right" : "")}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ov.users.map((u) => {
                const p = byEmail.get(u.email);
                const fixed = !!u.owner;
                return (
                  <TableRow key={u.email}>
                    <TableCell className="pl-6">
                      <span className="flex items-center gap-3"><Initials name={u.name} className="size-8 text-xs" />
                        <span className="min-w-0"><span className="block max-w-56 truncate font-medium">{u.name}</span><span className="block max-w-56 truncate font-mono text-[11px] text-muted-foreground">{u.email}</span></span></span>
                    </TableCell>
                    <TableCell>
                      {fixed ? <span className="font-mono text-xs text-muted-foreground">Admin (owner)</span> : (
                        <Select value={u.role} onValueChange={(v) => change({ email: u.email, role: v })}>
                          <SelectTrigger size="sm" className="h-8 w-32 rounded-full bg-card text-[13px]"><SelectValue /></SelectTrigger>
                          <SelectContent className="rounded-xl">{Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 font-mono text-[11px]",
                        u.status === "active" && "bg-success/10 text-success", u.status === "pending" && "bg-primary/10 text-primary", u.status === "blocked" && "bg-destructive/10 text-destructive")}>{u.status}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular">{(p?.annotating || 0) + (p?.reviewing || 0)}</TableCell>
                    <TableCell className="text-right font-mono tabular">{(p?.done || 0) + (p?.reviewed || 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{p?.lastActive ? fmtAgo(p.lastActive) : "–"}</TableCell>
                    <TableCell className="pr-4 text-right">
                      {!fixed && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="rounded-xl">
                            {u.status === "blocked"
                              ? <DropdownMenuItem onClick={() => change({ email: u.email, status: "active" }, "Unblocked")}><Undo2 /> Unblock</DropdownMenuItem>
                              : <DropdownMenuItem onClick={() => change({ email: u.email, status: "blocked" }, "Blocked: they can no longer open any file")}><Ban /> Block</DropdownMenuItem>}
                            <DropdownMenuItem className="text-destructive" onClick={async () => {
                              if (await confirm("Remove this person?", `${u.name} loses all assignments. Their saved annotations stay in your Drive.`, "Remove", "Cancel", true)) change({ email: u.email, remove: true }, "Removed");
                            }}><Trash2 /> Remove</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
