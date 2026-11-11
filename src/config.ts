import { NOTE_SCOPES, SCOPES, type OAuthConfig } from "./buffer/oauth";
import type { Env } from "./env";

/** BUFFER_SCOPES overrides the requested scopes (space-separated) if the App Client offers fewer. */
export function oauthConfig(env: Env & { BUFFER_SCOPES?: string }): OAuthConfig {
  const scopes = env.BUFFER_SCOPES
    ? env.BUFFER_SCOPES.split(/\s+/).filter(Boolean)
    : [...SCOPES, ...NOTE_SCOPES];
  return {
    clientId: env.BUFFER_CLIENT_ID,
    clientSecret: env.BUFFER_CLIENT_SECRET,
    redirectUri: env.BUFFER_REDIRECT_URI,
    scopes,
  };
}
