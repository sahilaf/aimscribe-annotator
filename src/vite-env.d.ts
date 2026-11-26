/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional: the Google OAuth client ID, set on the host at build time instead of in public/config.js */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
