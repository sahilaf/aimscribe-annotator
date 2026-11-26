// Promise-based dialogs, so logic code can `await confirm(...)` or `await prompt(...)`.
// Rendered by <DialogHost/>.
import { create } from "zustand";
import type { ReactNode } from "react";

export interface DialogAction<T = unknown> {
  label: string;
  value?: T;
  variant?: "default" | "ink" | "outline" | "ghost" | "destructive" | "secondary";
  /** Runs inside the click itself (needed to open Google's popup); resolve true to close. */
  run?: () => Promise<boolean>;
}

export interface DialogRequest {
  id: number;
  title: string;
  body?: ReactNode;
  actions: DialogAction[];
  input?: { label: string; value: string; multiline?: boolean; placeholder?: string };
  resolve: (v: unknown) => void;
  dismissValue?: unknown;
}

interface DialogState {
  queue: DialogRequest[];
  push(r: Omit<DialogRequest, "id">): void;
  close(id: number, v: unknown): void;
}

let n = 0;
export const useDialogs = create<DialogState>((set, get) => ({
  queue: [],
  push: (r) => set({ queue: [...get().queue, { ...r, id: ++n }] }),
  close: (id, v) => {
    const r = get().queue.find((x) => x.id === id);
    set({ queue: get().queue.filter((x) => x.id !== id) });
    r?.resolve(v);
  },
}));

export function ask<T = unknown>(title: string, body: ReactNode, actions: DialogAction<T>[], dismissValue: T | null = null): Promise<T | null> {
  return new Promise((resolve) => useDialogs.getState().push({ title, body, actions, resolve: resolve as (v: unknown) => void, dismissValue }));
}

export const confirm = (title: string, body: ReactNode, yes = "Continue", no = "Cancel", destructive = false) =>
  ask<boolean>(title, body, [{ label: no, value: false, variant: "ghost" }, { label: yes, value: true, variant: destructive ? "destructive" : "ink" }], false).then(Boolean);

export function prompt(title: string, label: string, value = "", opts: { multiline?: boolean; placeholder?: string; ok?: string } = {}): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.getState().push({
      title, input: { label, value, multiline: opts.multiline, placeholder: opts.placeholder },
      actions: [{ label: "Cancel", value: null, variant: "ghost" }, { label: opts.ok || "Save", value: "__input__", variant: "ink" }],
      resolve: resolve as (v: unknown) => void, dismissValue: null,
    }));
}
