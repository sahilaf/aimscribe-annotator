import { Progress } from "@/components/ui/progress";
import { useSession } from "@/state/session";
import { Logo } from "./bits";

export function LoadingOverlay() {
  const loading = useSession((s) => s.loading);
  if (!loading) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/70 p-6 backdrop-blur-sm animate-in fade-in-0">
      <div className="w-full max-w-xs rounded-3xl border bg-card p-6 shadow-soft">
        <div className="flex items-center gap-3">
          <Logo className="size-9 animate-pulse" />
          <div className="min-w-0">
            <p className="truncate font-medium">{loading.text}</p>
            <p className="font-mono text-xs text-muted-foreground tabular">
              {loading.progress == null ? "working…" : `${Math.round(loading.progress * 100)}%`}
            </p>
          </div>
        </div>
        {loading.progress != null && <Progress value={loading.progress * 100} className="mt-5 h-1.5" />}
      </div>
    </div>
  );
}
