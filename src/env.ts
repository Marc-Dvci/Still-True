import type { OrgDO } from "./durable/org";
import type { WorldDO } from "./durable/world";

export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  ORG: DurableObjectNamespace<OrgDO>;
  WORLD: DurableObjectNamespace<WorldDO>;
  BUFFER_CLIENT_ID: string;
  BUFFER_CLIENT_SECRET: string;
  BUFFER_REDIRECT_URI: string;
  /** base64 of 32 random bytes: signs session cookies. */
  SESSION_SECRET: string;
  /** base64 of 32 random bytes: AES-GCM key for Buffer tokens at rest and the OAuth state cookie. */
  TOKEN_KEY: string;
  /** "1" in tests: external calls are served from fixtures. */
  DEMO?: string;
  /** Public origin, used in notes written into Buffer. */
  PUBLIC_ORIGIN?: string;
  /** Local development only: "1" enables /dev/connect, which signs in with BUFFER_DEV_KEY. */
  DEV_KEY_LOGIN?: string;
  /** Local development only: a Buffer personal API key (Settings > API). */
  BUFFER_DEV_KEY?: string;
}
