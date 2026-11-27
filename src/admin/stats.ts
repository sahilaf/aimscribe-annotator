// Numbers for the admin dashboard, worked out from the overview (files, outputs, assignments).
import { itemStatus } from "@/lib/project.js";
import type { Overview, Person } from "@/lib/api";
import type { DataSet, Item, Output } from "@/editor/types";

/** 16 kHz mono 16-bit WAV: the length follows from the file size. Falls back to an annotation's own value. */
export const audioSec = (it: Item) => Math.max(0, ...it.outputs.map((o) => o.duration || 0), it.audio.size > 44 ? (it.audio.size - 44) / 32000 : 0);

export type ItemState = "unassigned" | "assigned" | "in_progress" | "returned" | "done" | "reviewed";
export const STATE_LABEL: Record<ItemState, string> = {
  unassigned: "Unassigned", assigned: "Assigned", in_progress: "In progress", returned: "Returned", done: "Done", reviewed: "Reviewed",
};

export function itemState(it: Item): ItemState {
  const st = itemStatus(it) as string;
  if (st !== "todo") return st as ItemState;
  return it.assigned?.some((a) => a.kind === "annotate") ? "assigned" : "unassigned";
}

const finished = (s: ItemState) => s === "done" || s === "reviewed";

export interface PersonStats extends Person {
  annotating: number; reviewing: number; inProgress: number; done: number; reviewed: number;
  speech: number; spent: number; spentDone: number; lastActive: string;
}

export function computeStats(ov: Overview) {
  const sets = ov.project.sets.map((set: DataSet) => {
    const counts: Record<ItemState, number> = { unassigned: 0, assigned: 0, in_progress: 0, returned: 0, done: 0, reviewed: 0 };
    let audio = 0, audioLeft = 0;
    for (const it of set.items) {
      const s = itemState(it);
      counts[s]++;
      const a = audioSec(it);
      audio += a;
      if (!finished(s)) audioLeft += a;
    }
    return { set, counts, audio, audioLeft, files: set.items.length };
  });

  const people = new Map<string, PersonStats>();
  const person = (email: string, name = email) => {
    let p = people.get(email);
    if (!p) {
      const u = ov.users.find((x) => x.email === email);
      p = { email, name: u?.name || name, picture: u?.picture, role: u?.role || "annotator", status: u?.status || "active", joined: u?.joined || "",
        annotating: 0, reviewing: 0, inProgress: 0, done: 0, reviewed: 0, speech: 0, spent: 0, spentDone: 0, lastActive: "" };
      people.set(email, p);
    }
    return p;
  };
  for (const u of ov.users) person(u.email, u.name);

  const outputs: { item: Item; o: Output }[] = [];
  let speechDone = 0, audioDone = 0, spentDone = 0;
  for (const set of ov.project.sets) for (const it of set.items) {
    for (const a of it.assigned || []) {
      const p = person(a.email);
      if (a.kind === "annotate") p.annotating++; else p.reviewing++;
    }
    for (const o of it.outputs) {
      outputs.push({ item: it, o });
      const p = person(o.annotator, o.annotatorName);
      p.spent += o.spent;
      if (o.updated > p.lastActive) p.lastActive = o.updated;
      if (o.status === "in_progress" || o.status === "returned") p.inProgress++;
      if (o.status === "done" || o.status === "reviewed") {
        if (o.status === "done") p.done++; else p.reviewed++;
        p.speech += o.speech;
        p.spentDone += o.spent;
        speechDone += o.speech;
        audioDone += o.duration || audioSec(it);
        spentDone += o.spent;
      }
    }
  }

  const totals = sets.reduce((t, s) => ({
    files: t.files + s.files, audio: t.audio + s.audio, audioLeft: t.audioLeft + s.audioLeft,
    finished: t.finished + s.counts.done + s.counts.reviewed, reviewed: t.reviewed + s.counts.reviewed,
    unassigned: t.unassigned + s.counts.unassigned, inProgress: t.inProgress + s.counts.in_progress + s.counts.returned,
  }), { files: 0, audio: 0, audioLeft: 0, finished: 0, reviewed: 0, unassigned: 0, inProgress: 0 });

  // Pace: working hours per hour of speech (r in docs/02) and the share of audio that is speech.
  const r = speechDone > 600 ? spentDone / speechDone : null;
  const speechShare = audioDone > 600 ? Math.min(0.9, speechDone / audioDone) : 0.46; // 0.46 from the audio audit
  const workLeft = r ? totals.audioLeft * speechShare * r : null;

  const reviewQueue = outputs.filter(({ o }) => o.status === "done").sort((a, b) => a.o.updated.localeCompare(b.o.updated));
  const recent = [...outputs].sort((a, b) => b.o.updated.localeCompare(a.o.updated)).slice(0, 8);
  const active = [...people.values()].filter((p) => p.status === "active" && p.role !== "admin" && (p.annotating || p.reviewing)).length;

  return { sets, people: [...people.values()], totals, speechDone, r, speechShare, workLeft, reviewQueue, recent, active };
}
