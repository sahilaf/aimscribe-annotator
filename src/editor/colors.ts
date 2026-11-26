// Speaker colours: soft pastel blocks with a stronger edge, readable in light and dark.
const LIGHT = [
  { fill: "#c9daf3", stroke: "#7aa2d9", dot: "#4f7fc4" },
  { fill: "#e2d0f0", stroke: "#a98acb", dot: "#8a63b5" },
  { fill: "#d3e7cb", stroke: "#86b675", dot: "#5b9a48" },
  { fill: "#f3e0c1", stroke: "#d4a45c", dot: "#c08532" },
  { fill: "#f4cfcf", stroke: "#d98686", dot: "#c45c5c" },
  { fill: "#c8e8e4", stroke: "#66b5ab", dot: "#3d988c" },
];
const DARK = [
  { fill: "#2c3d58", stroke: "#5d86c2", dot: "#86aee6" },
  { fill: "#3d3052", stroke: "#8d6db3", dot: "#b99ae0" },
  { fill: "#2f4430", stroke: "#6c9e5c", dot: "#98cc86" },
  { fill: "#4a3c25", stroke: "#b8893f", dot: "#e2b56c" },
  { fill: "#4c2d2d", stroke: "#bb6a6a", dot: "#ea9a9a" },
  { fill: "#24423f", stroke: "#4e9b91", dot: "#83cfc4" },
];
const SPECIAL_L: Record<string, { fill: string; stroke: string; dot: string }> = {
  "পটভূমি": { fill: "#e3e1dc", stroke: "#a9a59d", dot: "#8f8b83" },
  "?": { fill: "#fbe6b8", stroke: "#e0a83a", dot: "#d4931c" },
};
const SPECIAL_D: Record<string, { fill: string; stroke: string; dot: string }> = {
  "পটভূমি": { fill: "#34322f", stroke: "#77736b", dot: "#a29d94" },
  "?": { fill: "#4d3d1c", stroke: "#c9952f", dot: "#f0be5a" },
};

export function speakerColor(speaker: string, speakers: string[], dark = false) {
  const special = (dark ? SPECIAL_D : SPECIAL_L)[speaker];
  if (special) return special;
  const real = speakers.filter((s) => !(s in SPECIAL_L));
  const i = Math.max(0, real.indexOf(speaker));
  return (dark ? DARK : LIGHT)[i % LIGHT.length];
}

export const isDark = () => document.documentElement.classList.contains("dark");
