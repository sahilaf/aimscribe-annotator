import { useEffect, useRef } from "react";
import {
  ArrowLeft, BookOpen, Check, CircleAlert, CircleCheck, CloudOff, Download, FileJson, Keyboard, Loader2, MoreHorizontal, NotebookPen, Redo2, RotateCcw,
  ShieldCheck, Undo2, Users, X, Settings2, Cloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TimelineCanvas, LaneLabels } from "@/editor/TimelineView";
import { TransportRow, PillPlayer } from "@/editor/PlayerBar";
import { TranscriptList, EditorFilters } from "@/editor/TranscriptList";
import { Inspector, SegmentSheet, insertText } from "@/editor/Inspector";
import { ChecksDialog, SpeakersDialog, KeysDialog, RestartDialog, useIssues } from "@/editor/Panels";
import { player } from "@/editor/player";
import { openGuide } from "@/components/Guide";
import {
  useEditor, activeSeg, closeEditor, undo, redo, togglePlay, replay, checkAndNext, step, boundaryHere, split, mergeNext,
  setSpeaker, toggleOverlap, saveRemote, markDone, reopen, review, speakersOf,
} from "@/state/editor";
import { prompt } from "@/state/dialogs";
import { setNotes } from "@/state/editor";
import { docToSRT, BACKGROUND, UNSURE } from "@/lib/formats.js";
import { fmtAgo, fmtTime } from "@/lib/util.js";
import { useDesktop } from "@/hooks/use-media";
import { cn } from "@/lib/utils";
import { useState } from "react";

function download(name: string, text: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function currentDoc() {
  const s = useEditor.getState();
  return { ...s.doc!, segments: s.segs.map(({ id: _id, ...x }) => x) };
}

const prefOn = (k: string) => (localStorage.getItem("aimscribe:" + k) ?? "1") === "1";

function SaveStatus({ compact = false }: { compact?: boolean }) {
  const { saving, rev, savedRev, saveError, lastSaved, outputFileId, outputName } = useEditor();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30e3); return () => clearInterval(t); }, []);
  const state = saving ? "saving" : rev !== savedRev ? (saveError ? "error" : "local") : outputFileId ? "saved" : "fresh";
  const label = { saving: "Saving…", saved: lastSaved ? `Saved ${fmtAgo(lastSaved)}` : "Saved", error: "Not saved", local: "Unsaved", fresh: "Not started" }[state];
  const tip = { saving: "Uploading to Drive", saved: `Saved to Drive as ${outputName}`, error: `${saveError}. Kept on this device; tap to retry.`, local: "On this device; uploads in a few seconds", fresh: `Your first change creates ${outputName} on Drive` }[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={() => saveRemote(true).catch(() => {})}
          className={cn("flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary", state === "error" && "text-destructive")}>
          {state === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : state === "error" ? <CloudOff className="size-3.5" /> :
            <i className={cn("size-2 rounded-full", state === "saved" ? "bg-success" : state === "local" ? "bg-warning" : "bg-muted-foreground/40")} />}
          {!compact && <span>{label}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function ChecksButton() {
  const issues = useIssues();
  const errors = issues.filter((x) => x.level === "error").length;
  return (
    <Button variant="outline" size="sm" className="h-9" onClick={() => useEditor.setState({ panel: "checks" })}>
      {errors ? <CircleAlert className="text-destructive" /> : <CircleCheck className="text-success" />}
      {errors ? `${errors} to fix` : "All clear"}
    </Button>
  );
}

function PrimaryAction({ compact = false }: { compact?: boolean }) {
  const status = useEditor((s) => s.doc?.status);
  const mode = useEditor((s) => s.mode);
  if (mode === "review") {
    return (
      <div className="flex gap-2">
        <Button variant="outline" className={cn(compact ? "h-9" : "h-10")} onClick={() => review("returned")}><RotateCcw /> Return</Button>
        <Button variant="ink" className={cn(compact ? "h-9" : "h-10 px-5")} onClick={() => review("reviewed")}><ShieldCheck /> Accept</Button>
      </div>
    );
  }
  if (status === "done" || status === "reviewed") return <Button variant="outline" className="h-10" onClick={reopen}>Reopen</Button>;
  return <Button variant="ink" className="h-10 px-5" onClick={markDone}><Check strokeWidth={2.5} /> Mark as done</Button>;
}

function EditorMenu({ desktop }: { desktop: boolean }) {
  const mode = useEditor((s) => s.mode);
  const status = useEditor((s) => s.doc?.status);
  const item = useEditor((s) => s.item);
  const outputName = useEditor((s) => s.outputName);
  const [autoplay, setAutoplay] = useState(prefOn("autoplay"));
  const [tapplay, setTapplay] = useState(prefOn("tapplay"));
  const setPref = (k: string, v: boolean) => localStorage.setItem("aimscribe:" + k, v ? "1" : "0");
  const panel = (p: "checks" | "speakers" | "keys" | "restart") => useEditor.setState({ panel: p });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-2xl p-1.5">
        {!desktop && (
          <>
            {mode === "review" ? (
              <>
                <DropdownMenuItem onClick={() => review("reviewed")}><ShieldCheck /> Accept</DropdownMenuItem>
                <DropdownMenuItem onClick={() => review("returned")}><RotateCcw /> Return with a note</DropdownMenuItem>
              </>
            ) : status === "done" || status === "reviewed" ? (
              <DropdownMenuItem onClick={reopen}><RotateCcw /> Reopen</DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={markDone}><Check /> Mark as done</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => panel("checks")}><CircleAlert /> Checks</DropdownMenuItem>
            <DropdownMenuItem onClick={() => panel("speakers")}><Users /> Speakers and roles</DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              const t = await prompt("Notes for this file", "Anything the reviewer or data lead should know.", useEditor.getState().doc?.notes || "", { multiline: true });
              if (t != null) setNotes(t);
            }}><NotebookPen /> Notes</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => saveRemote(true).catch(() => {})}><Cloud /> Save to Drive now</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openGuide()}><BookOpen /> Annotation guide</DropdownMenuItem>
        {desktop && <DropdownMenuItem onClick={() => panel("keys")}><Keyboard /> Keyboard shortcuts</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 font-mono text-[11px] font-normal uppercase tracking-wider text-muted-foreground"><Settings2 className="size-3.5" /> Playback</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={autoplay} onCheckedChange={(v) => { setAutoplay(!!v); setPref("autoplay", !!v); }} onSelect={(e) => e.preventDefault()}>Play the next segment automatically</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={tapplay} onCheckedChange={(v) => { setTapplay(!!v); setPref("tapplay", !!v); }} onSelect={(e) => e.preventDefault()}>Play a segment when I tap it</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => download(`${item!.base}.srt`, docToSRT(currentDoc()), "text/plain")}><Download /> Download SRT</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download(outputName, JSON.stringify(currentDoc(), null, 1))}><FileJson /> Download JSON</DropdownMenuItem>
        {mode === "own" && <DropdownMenuItem onClick={() => panel("restart")}><RotateCcw /> Start again from another draft</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => closeEditor()}><X /> Close file</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Header({ desktop }: { desktop: boolean }) {
  const item = useEditor((s) => s.item);
  const doc = useEditor((s) => s.doc);
  const mode = useEditor((s) => s.mode);
  const ownerName = useEditor((s) => s.ownerName);
  const duration = useEditor((s) => s.duration);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const back = () => (history.state?.editor ? history.back() : closeEditor());
  const sub = mode === "review" ? `reviewing ${ownerName}` : doc?.source;
  return (
    <header className={cn("relative z-10 flex shrink-0 items-center gap-2 border-b bg-background/85 backdrop-blur-md", desktop ? "h-16 px-4" : "h-14 px-2 pt-[env(safe-area-inset-top)]")}>
      <Button variant="ghost" size="icon" onClick={back} aria-label="Back to files"><ArrowLeft /></Button>
      <div className="min-w-0">
        <p className="truncate font-semibold leading-tight tracking-tight">{item?.base}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{sub} · {fmtTime(duration, 0)}</p>
      </div>
      {desktop && (
        <div className="absolute left-1/2 flex -translate-x-1/2 gap-1">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 /></Button></TooltipTrigger><TooltipContent>Undo</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo"><Redo2 /></Button></TooltipTrigger><TooltipContent>Redo</TooltipContent></Tooltip>
        </div>
      )}
      <div className="flex-1" />
      <SaveStatus compact={!desktop} />
      {desktop ? (
        <>
          <ChecksButton />
          <PrimaryAction />
        </>
      ) : (
        <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo"><Undo2 /></Button>
      )}
      <EditorMenu desktop={desktop} />
    </header>
  );
}

function ReviewBanner() {
  const doc = useEditor((s) => s.doc);
  const r = doc?.review;
  if (!r || (doc.status !== "returned" && doc.status !== "reviewed")) return null;
  const returned = doc.status === "returned";
  return (
    <div className={cn("flex shrink-0 items-start gap-3 border-b px-5 py-3 text-sm", returned ? "bg-warning/10" : "bg-success/10")}>
      {returned ? <RotateCcw className="mt-0.5 size-4 shrink-0 text-warning" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />}
      <p><span className="font-medium">{returned ? `Returned by ${r.name || r.by}` : `Accepted by ${r.name || r.by}`}</span>
        <span className="text-muted-foreground"> · {fmtAgo(r.at)}</span>{r.note && <><br />{r.note}</>}</p>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const inText = (e.target as HTMLElement).matches?.("textarea, input");
      const k = e.code;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      const a = activeSeg();
      if (mod && k === "Space") { take(); return togglePlay(); }
      if (k === "Escape") { take(); return replay(); }
      if (mod && k === "Enter") { take(); return checkAndNext(); }
      if (mod && k === "ArrowDown") { take(); return step(1); }
      if (mod && k === "ArrowUp") { take(); return step(-1); }
      if (mod && e.shiftKey && k === "ArrowLeft") { take(); return player.seekBy(-2); }
      if (mod && e.shiftKey && k === "ArrowRight") { take(); return player.seekBy(2); }
      if (mod && k === "KeyS") { take(); return saveRemote(true).catch(() => {}); }
      if (!inText && mod && k === "KeyZ") { take(); return e.shiftKey ? redo() : undo(); }
      if (!inText && mod && k === "KeyY") { take(); return redo(); }
      if (e.altKey && !mod) {
        if (k === "BracketLeft") { take(); return boundaryHere("start"); }
        if (k === "BracketRight") { take(); return boundaryHere("end"); }
        if (k === "KeyS") { take(); const el = document.querySelector<HTMLTextAreaElement>("textarea.transcript-text"); return split(el && document.activeElement === el ? el.selectionStart : null); }
        if (k === "KeyM") { take(); return mergeNext(); }
        if (k === "KeyO" && a) { take(); return toggleOverlap(a.id); }
        if (k === "KeyU") { take(); return insertText("[অস্পষ্ট]"); }
        if (k === "Digit0" && a) { take(); return setSpeaker(a.id, BACKGROUND); }
        const d = k.match(/^Digit([1-9])$/);
        if (d && a) {
          take();
          const sp = speakersOf().filter((x) => x !== BACKGROUND && x !== UNSURE);
          const v = sp[+d[1] - 1] || (+d[1] === sp.length + 1 ? `S${sp.length + 1}` : null);
          if (v) setSpeaker(a.id, v);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

export function Editor() {
  const desktop = useDesktop();
  const listRef = useRef<HTMLElement>(null);
  useShortcuts();

  if (desktop) {
    return (
      <div className="flex h-dvh flex-col">
        <Header desktop />
        <ReviewBanner />
        <div className="flex min-h-0 flex-1">
          <main ref={listRef} className="min-w-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-[5] border-b bg-background/85 backdrop-blur-md">
              <EditorFilters className="mx-auto max-w-[860px] px-10 py-3" />
            </div>
            <TranscriptList variant="desktop" scrollRef={listRef} />
          </main>
          <aside className="w-[340px] shrink-0 overflow-y-auto border-l bg-sidebar">
            <Inspector />
          </aside>
        </div>
        <footer className="shrink-0 border-t bg-card">
          <div className="flex pt-2">
            <LaneLabels />
            <div className="min-w-0 flex-1 pr-4 pl-2"><TimelineCanvas /></div>
          </div>
          <TransportRow />
        </footer>
        <ChecksDialog /><SpeakersDialog /><KeysDialog /><RestartDialog />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <Header desktop={false} />
      <ReviewBanner />
      <div className="shrink-0 border-b bg-card px-3 pt-2 pb-1"><TimelineCanvas compact /></div>
      <main ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-[5] bg-background/90 px-3 py-2 backdrop-blur-md">
          <EditorFilters />
        </div>
        <div className="mx-auto max-w-2xl"><TranscriptList variant="mobile" scrollRef={listRef} /></div>
      </main>
      <PillPlayer />
      <SegmentSheet />
      <ChecksDialog /><SpeakersDialog /><RestartDialog />
    </div>
  );
}
