import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Logo, MonoLabel } from "@/components/bits";
import { useSession, loadOverview } from "@/state/session";
import { UserMenu } from "./Home";
import { computeStats } from "@/admin/stats";
import { OverviewTab } from "@/admin/OverviewTab";
import { TasksTab } from "@/admin/TasksTab";
import { PeopleTab } from "@/admin/PeopleTab";
import { SettingsTab } from "@/admin/SettingsTab";
import { cn } from "@/lib/utils";

export type Tab = "overview" | "tasks" | "people" | "settings";

/** The project lead's view: progress, assigning files, people, and the Drive connection. */
export function Dashboard() {
  const { overview, me, listError } = useSession();
  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem("aimscribe:tab") as Tab) || "overview");
  const [busy, setBusy] = useState(false);
  const setTab = (t: Tab) => { setTabState(t); localStorage.setItem("aimscribe:tab", t); };
  const driveOff = me?.drive.connected === false;
  const stats = useMemo(() => (overview ? computeStats(overview) : null), [overview]);
  const pending = overview?.users.filter((u) => u.status === "pending").length || 0;

  const refresh = async (fresh = true) => { setBusy(true); await loadOverview(fresh); setBusy(false); };
  useEffect(() => { if (!driveOff) refresh(false); }, [driveOff]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (driveOff) setTab("settings"); }, [driveOff]);

  const tabs: [Tab, string, number?][] = [["overview", "Overview"], ["tasks", "Tasks"], ["people", "People", pending], ["settings", "Settings"]];
  const nav = (
    <ToggleGroup type="single" spacing={1} value={tab} onValueChange={(v) => v && setTab(v as Tab)} className="no-scrollbar w-auto max-w-full overflow-x-auto">
      {tabs.map(([t, label, n]) => (
        <ToggleGroupItem key={t} value={t} disabled={driveOff && t !== "settings"}
          className="h-9 shrink-0 rounded-full px-4 text-[13px] data-[state=on]:bg-ink data-[state=on]:text-ink-foreground">
          {label}
          {!!n && <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] text-primary-foreground">{n}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">AIMScribe</p>
            <MonoLabel className="text-[10px]">Admin</MonoLabel>
          </div>
          <div className="mx-4 hidden md:block">{nav}</div>
          <div className="flex-1" />
          {!driveOff && (
            <Button variant="ghost" size="icon" onClick={() => refresh(true)} aria-label="Refresh from Drive" title="Refresh from Drive">
              <RefreshCw className={cn(busy && "animate-spin")} />
            </Button>
          )}
          <UserMenu onRefresh={() => refresh(true)} />
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-3 md:hidden">{nav}</div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6">
        {listError && !driveOff && (
          <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="font-medium text-destructive">Could not load the project: </span>{listError}
          </div>
        )}
        {tab === "settings" || driveOff ? <SettingsTab /> :
          !overview || !stats ? <DashSkeleton /> :
          tab === "overview" ? <OverviewTab ov={overview} stats={stats} goto={setTab} /> :
          tab === "tasks" ? <TasksTab ov={overview} refresh={() => refresh(false)} /> :
          <PeopleTab ov={overview} stats={stats} refresh={() => refresh(false)} />}
      </main>
    </div>
  );
}

function DashSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-3xl bg-card" />)}
      </div>
      <div className="h-64 animate-pulse rounded-3xl bg-card" />
    </div>
  );
}
