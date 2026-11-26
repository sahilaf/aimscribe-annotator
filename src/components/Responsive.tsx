// A dialog on a computer, a bottom sheet (drawer) on a phone. Same content either way.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useDesktop } from "@/hooks/use-media";
import { cn } from "@/lib/utils";
import { MonoLabel } from "./bits";

export function Responsive({ open, onOpenChange, eyebrow, title, description, children, wide = false }: {
  open: boolean; onOpenChange: (o: boolean) => void; eyebrow?: string; title: ReactNode; description?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const desktop = useDesktop();
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("max-h-[86dvh] gap-0 overflow-hidden rounded-3xl p-0", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
          <DialogHeader className="px-6 pt-6 pb-4">
            {eyebrow && <MonoLabel>{eyebrow}</MonoLabel>}
            <DialogTitle className="text-xl tracking-tight">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{String(title)}</DialogDescription>}
          </DialogHeader>
          <div className="overflow-y-auto px-6 pb-6">{children}</div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh] rounded-t-[28px]">
        <DrawerHeader className="px-5 pt-3 pb-3 text-left">
          {eyebrow && <MonoLabel>{eyebrow}</MonoLabel>}
          <DrawerTitle className="text-left text-xl tracking-tight">{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : <DrawerDescription className="sr-only">{String(title)}</DrawerDescription>}
        </DrawerHeader>
        <div className="overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))]">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
