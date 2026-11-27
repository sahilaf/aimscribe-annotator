import { useState } from "react";
import { ArrowRight, Lock, Sparkles, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo, MonoLabel } from "@/components/bits";
import { CLIENT_ID, signIn, devSignIn, startDemo, useSession } from "@/state/session";

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3Z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

function DevSignIn() {
  const [email, setEmail] = useState("admin@demo.test");
  return (
    <form className="mt-5 grid gap-2 rounded-2xl border border-dashed p-4" onSubmit={(e) => { e.preventDefault(); devSignIn(email); }}>
      <p className="flex items-center gap-2 text-sm font-medium"><FlaskConical className="size-4" /> Local test backend</p>
      <p className="text-xs text-muted-foreground">Sign in as anyone. <code className="font-mono">admin@demo.test</code> is the admin.</p>
      <div className="flex gap-2">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 rounded-full" />
        <Button type="submit" variant="outline" className="h-10">Go</Button>
      </div>
    </form>
  );
}

export function SignIn() {
  const { apiReady, signinError, backendDemo } = useSession();
  const hint = localStorage.getItem("aimscribe:hint");
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-48 size-[480px] rounded-full bg-ink/5 blur-3xl" />
      <div className="relative w-full max-w-[400px]">
        <div className="rounded-[28px] border bg-card/90 p-7 shadow-soft backdrop-blur sm:p-8">
          <Logo className="size-11" />
          <h1 className="mt-6 text-[26px] font-semibold tracking-tight">AIMScribe Annotator</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Correct Bangla consultation transcripts by listening, on your phone or computer.
          </p>

          <div className="mt-7 grid gap-2.5">
            <Button variant="ink" className="h-12 text-[15px]" disabled={!CLIENT_ID || !apiReady} onClick={() => signIn()}>
              <span className="grid size-6 place-items-center rounded-full bg-white"><GoogleG /></span>
              {hint ? `Continue as ${hint}` : "Continue with Google"}
            </Button>
            <Button variant="ghost" className="h-11 text-muted-foreground" onClick={startDemo}>
              <Sparkles /> Try the demo <ArrowRight className="opacity-60" />
            </Button>
          </div>

          {backendDemo && <DevSignIn />}
          {signinError && <p className="mt-4 text-sm text-destructive">{signinError}</p>}
        </div>

        <div className="mt-5 flex items-start gap-2.5 px-3">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <MonoLabel className="normal-case tracking-normal leading-relaxed">
            Google is used only to confirm your email. You get no access to anyone’s Drive; you see only the files the project lead assigns to you.{" "}
            <a href="./privacy" className="underline underline-offset-2 hover:text-foreground">Privacy</a>
          </MonoLabel>
        </div>
      </div>
    </div>
  );
}
