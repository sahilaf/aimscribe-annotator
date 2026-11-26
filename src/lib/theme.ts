// Light by default on every device; each person can pick dark, or follow the device, in the account menu.
export type Theme = "light" | "dark" | "system";

const KEY = "aimscribe:theme";
const media = matchMedia("(prefers-color-scheme: dark)");

export const getTheme = (): Theme => (localStorage.getItem(KEY) as Theme) || "light";

export function applyTheme(t: Theme = getTheme()) {
  const dark = t === "dark" || (t === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#151413" : "#f5f4f1");
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

media.addEventListener("change", () => { if (getTheme() === "system") applyTheme(); });
