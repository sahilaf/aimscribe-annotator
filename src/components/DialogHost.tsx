import { useState, useEffect } from "react";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useDialogs, type DialogRequest } from "@/state/dialogs";

/** Shows the first queued confirm/prompt dialog. */
export function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);
  return req ? <One key={req.id} req={req} /> : null;
}

function One({ req }: { req: DialogRequest }) {
  const close = useDialogs((s) => s.close);
  const [value, setValue] = useState(req.input?.value ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(req.input?.value ?? ""), [req]);
  const finish = (v: unknown) => close(req.id, v === "__input__" ? value : v);
  const primary = [...req.actions].reverse().find((a) => a.variant === "ink" || a.variant === "default" || a.variant === "destructive");
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) finish(req.dismissValue ?? null); }}>
      <AlertDialogContent className="rounded-3xl sm:max-w-md" onEscapeKeyDown={() => finish(req.dismissValue ?? null)}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">{req.title}</AlertDialogTitle>
          {req.body != null && <AlertDialogDescription className="text-[15px] leading-relaxed break-words">{req.body}</AlertDialogDescription>}
        </AlertDialogHeader>
        {req.input && (
          <form
            className="grid gap-2"
            onSubmit={(e) => { e.preventDefault(); if (primary && !req.input?.multiline) finish(primary.value); }}
          >
            <Label className="text-muted-foreground font-normal leading-snug">{req.input.label}</Label>
            {req.input.multiline ? (
              <Textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={req.input.placeholder} className="min-h-24 text-base" />
            ) : (
              <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={req.input.placeholder} className="h-11 text-base" />
            )}
          </form>
        )}
        <AlertDialogFooter className="gap-2">
          {req.actions.map((a, i) => (
            <Button
              key={i}
              variant={a.variant || "outline"}
              disabled={busy}
              className="h-10 px-5"
              onClick={() => {
                if (!a.run) return finish(a.value);
                setBusy(true); // run() starts inside this click (Google's popup needs that)
                a.run().then((ok) => { setBusy(false); if (ok) finish(true); });
              }}
            >
              {a.label}
            </Button>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
