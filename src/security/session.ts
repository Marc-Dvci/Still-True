// Cookies: a signed session cookie naming the Buffer account, and an encrypted, short-lived cookie that
// carries the OAuth state and PKCE verifier between /auth/login and /auth/callback.
import { importAesKey, open, seal, sign, verify } from "./crypto";

export const SESSION_COOKIE = "__Host-st_session";
export const OAUTH_COOKIE = "__Host-st_oauth";
const SESSION_DAYS = 30;
const OAUTH_MINUTES = 10;

export interface Session {
  accountId: string;
  exp: number;
}

export interface OAuthPending {
  state: string;
  verifier: string;
  exp: number;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function sessionCookie(secret: string, accountId: string, now = Date.now()): Promise<string> {
  const exp = now + SESSION_DAYS * 86_400_000;
  return cookie(SESSION_COOKIE, await sign(secret, { accountId, exp }), SESSION_DAYS * 86_400);
}

export async function readSession(request: Request, secret: string, now = Date.now()): Promise<Session | null> {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  const session = await verify<Session>(secret, raw);
  if (!session || typeof session.accountId !== "string" || session.exp < now) return null;
  return session;
}

export async function oauthCookie(
  tokenKey: string,
  pending: Omit<OAuthPending, "exp">,
  now = Date.now(),
): Promise<string> {
  const value = await seal(
    await importAesKey(tokenKey),
    JSON.stringify({ ...pending, exp: now + OAUTH_MINUTES * 60_000 }),
    "oauth",
  );
  return cookie(OAUTH_COOKIE, value, OAUTH_MINUTES * 60);
}

export async function readOAuthCookie(
  request: Request,
  tokenKey: string,
  now = Date.now(),
): Promise<OAuthPending | null> {
  const raw = readCookie(request, OAUTH_COOKIE);
  if (!raw) return null;
  try {
    const pending = JSON.parse(await open(await importAesKey(tokenKey), raw, "oauth")) as OAuthPending;
    return pending.exp >= now ? pending : null;
  } catch {
    return null;
  }
}

/** State-changing browser requests must come from this origin (CSRF defence alongside SameSite=Lax). */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
