// Sign-in: a teammate's browser gets a Google access token with the basic "email profile" scopes
// only (no Drive). The Worker checks with Google that the token was issued to this app, then
// sets its own signed session cookie. Nothing else about the person's Google account is used.
import type { Env } from "./env";

export interface Session { email: string; name: string; picture?: string; exp: number }

const COOKIE = "as_session";
const DAYS = 14;
const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key(env: Env) {
  // Derived from the client secret, so there is one secret less to manage. Resetting the client
  // secret signs everyone out, which is what you want after a leak.
  const material = env.GOOGLE_CLIENT_SECRET || (env.DEMO === "1" ? "local-demo-only" : "");
  if (!material) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`aimscribe-session:${material}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(env: Env, data: string) {
  return b64url(await crypto.subtle.sign("HMAC", await key(env), enc.encode(data)));
}

export async function verifySig(env: Env, data: string, sig: string) {
  try { return await crypto.subtle.verify("HMAC", await key(env), fromB64url(sig), enc.encode(data)); } catch { return false; }
}

export async function makeCookie(env: Env, s: Omit<Session, "exp">, secure: boolean) {
  const session: Session = { ...s, email: s.email.toLowerCase(), exp: Date.now() + DAYS * 86400e3 };
  const data = b64url(enc.encode(JSON.stringify(session)));
  const value = `${data}.${await sign(env, data)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? "; Secure" : ""}`;
}

export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export async function readSession(env: Env, req: Request): Promise<Session | null> {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [data, sig] = m[1].split(".");
  if (!data || !sig || !(await verifySig(env, data, sig))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(data))) as Session;
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

/** Confirm with Google that the access token belongs to a verified email and was issued to this app. */
export async function verifyGoogleToken(env: Env, accessToken: string) {
  const info = (await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`)).json()) as
    { aud?: string; azp?: string; email?: string; email_verified?: string | boolean; error_description?: string };
  if (!info.email || (info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID)) {
    throw new Error(info.error_description || "Google could not confirm this sign-in");
  }
  if (!(info.email_verified === true || info.email_verified === "true")) throw new Error("This Google account's email is not verified");
  const profile = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } })).json().catch(() => ({}))) as
    { name?: string; picture?: string };
  return { email: info.email.toLowerCase(), name: profile.name || info.email, picture: profile.picture };
}
