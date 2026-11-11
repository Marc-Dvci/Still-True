// Buffer OAuth 2.0: Authorization Code with PKCE (S256), as Buffer requires for every App Client.
// Refresh tokens are single-use and rotate on every refresh; reusing an old one revokes the grant,
// so exactly one owner (the account's Durable Object) refreshes.

export const AUTHORIZE_URL = "https://auth.buffer.com/auth";
export const TOKEN_URL = "https://auth.buffer.com/token";
export const REVOKE_URL = "https://auth.buffer.com/token/revocation";

/** The narrowest scopes that let Still True read the queue, hold posts, and explain why. */
export const SCOPES = ["account:read", "posts:read", "posts:write", "offline_access"] as const;
export const NOTE_SCOPES = ["notes:read", "notes:write"] as const;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: number;
}

export class OAuthError extends Error {
  override name = "OAuthError";
  constructor(
    message: string,
    readonly oauthCode: string | null,
  ) {
    super(message);
  }
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  return { verifier, challenge: await pkceChallenge(verifier) };
}

export function buildAuthorizeUrl(config: OAuthConfig, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
  }).toString();
  return url.toString();
}

async function tokenRequest(
  config: OAuthConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  now: number,
): Promise<TokenSet> {
  // Buffer's authorization server advertises `client_secret_post`: the secret goes in the form body.
  const body = new URLSearchParams({ client_id: config.clientId, ...params });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.error === "string") {
    const code = typeof json.error === "string" ? json.error : null;
    const detail = typeof json.error_description === "string" ? json.error_description : code;
    throw new OAuthError(detail ?? `Token endpoint answered HTTP ${response.status}`, code);
  }
  if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string") {
    throw new OAuthError(
      "Buffer returned no refresh token; offline_access must be enabled",
      "no_refresh_token",
    );
  }
  const expiresIn = Number(json.expires_in) || 3600;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    scope: typeof json.scope === "string" ? json.scope : config.scopes.join(" "),
    // Refresh 60 s early so a request never starts with a token about to expire.
    expiresAt: now + expiresIn * 1000 - 60_000,
  };
}

export function exchangeCode(
  config: OAuthConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  return tokenRequest(
    config,
    { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: verifier },
    fetchImpl,
    now,
  );
}

export function refreshTokens(
  config: OAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl, now);
}

export async function revokeToken(
  config: OAuthConfig,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const body = new URLSearchParams({ client_id: config.clientId, token });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const response = await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return response.ok;
}
