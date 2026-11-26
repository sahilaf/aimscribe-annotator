import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
  );
}

/** True while the app is in dark mode (the `dark` class on <html>, set by lib/theme.ts). */
export function useDark() {
  return useSyncExternalStore(
    (cb) => {
      const o = new MutationObserver(cb);
      o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => o.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
  );
}
export const useDesktop = () => useMediaQuery("(min-width: 1024px)");
export const useCoarse = () => useMediaQuery("(pointer: coarse)");
