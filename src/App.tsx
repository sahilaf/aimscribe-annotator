import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DialogHost } from "@/components/DialogHost";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { OpenFileDialog } from "@/components/OpenFileDialog";
import { SignIn } from "@/screens/SignIn";
import { Home } from "@/screens/Home";
import { Editor } from "@/screens/Editor";
import { useSession } from "@/state/session";
import { useDesktop } from "@/hooks/use-media";

export default function App() {
  const screen = useSession((s) => s.screen);
  const desktop = useDesktop();
  return (
    <TooltipProvider delayDuration={400}>
      {screen === "signin" && <SignIn />}
      {screen === "home" && <Home />}
      {screen === "editor" && <Editor />}
      <OpenFileDialog />
      <DialogHost />
      <LoadingOverlay />
      <Toaster position={desktop ? "bottom-right" : "top-center"} offset={desktop ? 24 : 16} />
    </TooltipProvider>
  );
}
