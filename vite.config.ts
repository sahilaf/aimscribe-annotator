import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Content-Security-Policy goes only into the production build: the dev server needs inline
// scripts for hot reload. It allows our own files, Google sign-in and the Drive API, nothing else.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://oauth2.googleapis.com",
  "frame-src https://accounts.google.com/gsi/",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<!--csp-->", `<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
});

export default defineConfig({
  base: "./", // works at any path: a GitHub Pages project URL, a subfolder, or a domain root
  plugins: [react(), tailwindcss(), csp()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { chunkSizeWarningLimit: 800 }, // one small single-page app: no need to split
  // `npm run dev` + `npm run dev:api`: the site on :8000 talks to the local Worker on :8787
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
