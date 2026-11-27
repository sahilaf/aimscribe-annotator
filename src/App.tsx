import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DialogHost } from "@/components/DialogHost";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { OpenFileDialog } from "@/components/OpenFileDialog";
import { Logo } from "@/components/bits";
import { SignIn } from "@/screens/SignIn";
import { Waiting } from "@/screens/Waiting";
import { Home } from "@/screens/Home";
import { Dashboard } from "@/screens/Dashboard";
import { Editor } from "@/screens/Editor";
import { useSession } from "@/state/session";
import { useDesktop } from "@/hooks/use-media";

export default function App() {
  const screen = useSession((s) => s.screen);
  const desktop = useDesktop();
  return (
    <TooltipProvider delayDuration={400}>
      {screen === "loading" && <div className="grid min-h-full place-items-center"><Logo className="size-10 animate-pulse" /></div>}
      {screen === "signin" && <SignIn />}
      {screen === "waiting" && <Waiting />}
      {screen === "home" && <Home />}
      {screen === "admin" && <Dashboard />}
      {screen === "editor" && <Editor />}
      <OpenFileDialog />
      <DialogHost />
      <LoadingOverlay />
      <Toaster position={desktop ? "bottom-right" : "top-center"} offset={desktop ? 24 : 16} />
    </TooltipProvider>
  );
}
