import { useEffect } from "react";
import { BookOpen, Hourglass, LogOut, RefreshCw } from "lucide-react";
import { openGuide } from "@/components/Guide";
import { Button } from "@/components/ui/button";
import { Logo, MonoLabel, Initials } from "@/components/bits";
import { useSession, refreshMe, signOut } from "@/state/session";

/** Signed in, but the project lead has not assigned any files yet. Checks again on its own. */
export function Waiting() {
  const me = useSession((s) => s.me);
  useEffect(() => {
    const t = setInterval(refreshMe, 20e3);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <div className="w-full max-w-[420px] rounded-[28px] border bg-card p-7 shadow-soft sm:p-8">
        <div className="flex items-center justify-between">
          <Logo className="size-10" />
          {me && <Initials name={me.name} className="size-9 text-xs" />}
        </div>
        <div className="mt-7 grid size-12 place-items-center rounded-2xl bg-secondary"><Hourglass className="size-5" /></div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">You’re on the list</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {me?.drive.connected === false
            ? "The project isn’t set up yet. Check back once the project lead has connected the data."
            : "The project lead will give you access and assign your first files. This page updates on its own."}
        </p>
        <div className="mt-6 rounded-2xl bg-secondary px-4 py-3">
          <MonoLabel className="text-[10px]">Signed in as</MonoLabel>
          <p className="mt-0.5 truncate font-mono text-sm">{me?.email}</p>
        </div>
        <Button className="mt-6 w-full" onClick={() => openGuide()}><BookOpen /> Read the annotation guide while you wait</Button>
        <div className="mt-2 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={refreshMe}><RefreshCw /> Check now</Button>
          <Button variant="ghost" onClick={signOut}><LogOut /> Sign out</Button>
        </div>
      </div>
    </div>
  );
}
