// Settings the Worker reads. Secrets are set in Cloudflare (Settings → Variables and Secrets),
// never in this repository.
export interface Env {
  ASSETS: Fetcher;
  /** Public OAuth client ID (also in public/config.js). Set in wrangler.jsonc. */
  GOOGLE_CLIENT_ID: string;
  /** Secret: the OAuth client secret, used only for the admin's one-time Drive connection. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Secret: comma-separated emails that are always admins. */
  ADMIN_EMAILS?: string;
  /** Secret: the admin's Drive refresh token, shown once after "Connect Drive". */
  DRIVE_REFRESH_TOKEN?: string;
  /** Local testing only (.dev.vars): "1" uses a fake in-memory Drive and allows sign-in by typing an email. */
  DEMO?: string;
}
