// Small helpers shared by every module. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** h('button', {class: 'x', onclick: fn}, 'text', child) -> element. Strings are text, never HTML. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v; // only ever given escaped HTML
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style" && typeof v === "object") for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** 75.25 -> "1:15.3"; with hours when needed. */
export function fmtTime(s, decimals = 1) {
  if (s == null || !isFinite(s)) return "–";
  const neg = s < 0;
  s = Math.abs(s);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const sec = decimals ? ss.toFixed(decimals).padStart(3 + decimals, "0") : String(Math.floor(ss)).padStart(2, "0");
  return (neg ? "-" : "") + (hh ? `${hh}:${String(mm).padStart(2, "0")}:${sec}` : `${mm}:${sec}`);
}

export function fmtHours(sec) {
  if (!sec) return "0 h";
  if (sec < 60) return `${Math.round(sec)} s`;
  const h = sec / 3600;
  return h < 1 ? `${Math.round(sec / 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`;
}

export function fmtAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.round(d / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtMB = (bytes) => (bytes ? `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB` : "");

export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
