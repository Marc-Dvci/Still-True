import { describe, expect, it, vi } from "vitest";
import {
  BufferApiError,
  BufferAuthError,
  BufferClient,
  BufferRateLimitError,
  mutationFailed,
  parseRateBudget,
} from "../../src/buffer/client";
import {
  buildAuthorizeUrl,
  exchangeCode,
  OAuthError,
  pkceChallenge,
  refreshTokens,
  revokeToken,
} from "../../src/buffer/oauth";
import { importAesKey, open, seal, sha256Hex, sign, verify } from "../../src/security/crypto";
import { readCookie, sameOrigin } from "../../src/security/session";

const KEY = "dG9rZW4ta2V5LWZvci10ZXN0cy1vbmx5LTMyYnl0ZXM=";
const config = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://still-true.test/auth/callback",
  scopes: ["posts:read", "offline_access"],
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("token encryption", () => {
  it("round-trips, and fails for another owner or a tampered value", async () => {
    const key = await importAesKey(KEY);
    const sealed = await seal(key, "refresh-token", "account-1");
    expect(await open(key, sealed, "account-1")).toBe("refresh-token");
    await expect(open(key, sealed, "account-2")).rejects.toThrow();
    // Change one full character inside the ciphertext (the last one also carries unused padding bits).
    const at = sealed.length - 10;
    const tampered = sealed.slice(0, at) + (sealed[at] === "A" ? "B" : "A") + sealed.slice(at + 1);
    await expect(open(key, tampered, "account-1")).rejects.toThrow();
    await expect(open(key, "garbage", "account-1")).rejects.toThrow();
  });

  it("refuses a key that is not 32 bytes", async () => {
    await expect(importAesKey(btoa("short"))).rejects.toThrow("32 bytes");
  });

  it("uses a fresh IV for every value", async () => {
    const key = await importAesKey(KEY);
    expect(await seal(key, "same", "a")).not.toBe(await seal(key, "same", "a"));
  });
});

describe("signed cookies", () => {
  it("verifies its own signature and rejects any change", async () => {
    const token = await sign(KEY, { accountId: "a1", exp: 1 });
    expect(await verify(KEY, token)).toEqual({ accountId: "a1", exp: 1 });
    const [body, signature] = token.split(".");
    expect(await verify(KEY, `${body}x.${signature}`)).toBeNull();
    expect(await verify(KEY, "nonsense")).toBeNull();
    expect(await verify(KEY, "a.!!!")).toBeNull();
  });

  it("reads cookies and recognises same-origin requests", () => {
    const request = new Request("https://still-true.test/api/me/check", {
      method: "POST",
      headers: { cookie: "a=1; __Host-st_session=xyz=; b=2", "sec-fetch-site": "same-origin" },
    });
    expect(readCookie(request, "__Host-st_session")).toBe("xyz=");
    expect(readCookie(request, "missing")).toBeNull();
    expect(sameOrigin(request)).toBe(true);
    expect(
      sameOrigin(new Request("https://still-true.test/x", { headers: { "sec-fetch-site": "cross-site" } })),
    ).toBe(false);
    expect(
      sameOrigin(new Request("https://still-true.test/x", { headers: { origin: "https://evil.example" } })),
    ).toBe(false);
    expect(
      sameOrigin(
        new Request("https://still-true.test/x", { headers: { origin: "https://still-true.test" } }),
      ),
    ).toBe(true);
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("Buffer OAuth", () => {
  it("computes the PKCE challenge of RFC 7636's test vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds Buffer's authorize URL with S256 PKCE", () => {
    const url = new URL(buildAuthorizeUrl(config, "state-1", "challenge-1"));
    expect(url.origin + url.pathname).toBe("https://auth.buffer.com/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client",
      response_type: "code",
      scope: "posts:read offline_access",
      state: "state-1",
      code_challenge: "challenge-1",
      code_challenge_method: "S256",
    });
  });

  it("exchanges a code with the secret in the form body", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("code_verifier")).toBe("verifier");
      return json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "posts:read" });
    });
    const tokens = await exchangeCode(
      config,
      "code",
      "verifier",
      fetchImpl as unknown as typeof fetch,
      1_000_000,
    );
    expect(tokens).toEqual({
      accessToken: "a",
      refreshToken: "r",
      scope: "posts:read",
      expiresAt: 1_000_000 + 3_600_000 - 60_000,
    });
  });

  it("reports Buffer's OAuth errors and a missing refresh token", async () => {
    const failing = async () => json({ error: "invalid_grant", error_description: "Code expired" }, 400);
    await expect(exchangeCode(config, "c", "v", failing as unknown as typeof fetch)).rejects.toThrow(
      OAuthError,
    );
    const noRefresh = async () => json({ access_token: "a" });
    await expect(exchangeCode(config, "c", "v", noRefresh as unknown as typeof fetch)).rejects.toThrow(
      "refresh token",
    );
  });

  it("rotates refresh tokens and revokes", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      if (body.get("grant_type") === "refresh_token")
        return json({ access_token: "a2", refresh_token: "r2" });
      return new Response(null, { status: 200 });
    });
    const tokens = await refreshTokens(config, "r1", fetchImpl as unknown as typeof fetch, 0);
    expect(tokens.refreshToken).toBe("r2");
    expect(await revokeToken(config, "r2", fetchImpl as unknown as typeof fetch)).toBe(true);
  });
});

describe("Buffer API client", () => {
  const client = (response: Response) =>
    new BufferClient({
      token: async () => "t",
      fetchImpl: (async () => response) as unknown as typeof fetch,
    });

  it("returns data and counts requests", async () => {
    const c = client(json({ data: { ok: 1 } }, 200, { RateLimit: "limit=100, remaining=97, reset=812" }));
    expect(await c.request("query { ok }")).toEqual({ ok: 1 });
    expect(c.requests).toBe(1);
  });

  it("turns 401 and UNAUTHENTICATED into an auth error", async () => {
    await expect(client(json({}, 401)).request("q")).rejects.toThrow(BufferAuthError);
    await expect(
      client(json({ errors: [{ message: "x", extensions: { code: "UNAUTHENTICATED" } }] })).request("q"),
    ).rejects.toThrow(BufferAuthError);
  });

  it("turns 429 into a rate-limit error with Buffer's Retry-After", async () => {
    const error = await client(
      json({ errors: [{ extensions: { code: "RATE_LIMIT_EXCEEDED", window: "15m" } }] }, 429, {
        "retry-after": "42",
      }),
    )
      .request("q")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BufferRateLimitError);
    expect((error as BufferRateLimitError).retryAfterSeconds).toBe(42);
    expect((error as BufferRateLimitError).window).toBe("15m");
  });

  it("turns GraphQL errors into an API error with its code", async () => {
    const error = await client(
      json({ errors: [{ message: "Bad field", extensions: { code: "BAD_USER_INPUT" } }] }),
    )
      .request("q")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BufferApiError);
    expect((error as BufferApiError).code).toBe("BAD_USER_INPUT");
  });

  it("reads RateLimit headers in both forms", () => {
    expect(parseRateBudget(new Headers({ RateLimit: "limit=100, remaining=7, reset=60" }), 1)).toMatchObject({
      limit: 100,
      remaining: 7,
      resetSeconds: 60,
    });
    expect(parseRateBudget(new Headers({ "RateLimit-Remaining": "5" }), 1).remaining).toBe(5);
    expect(parseRateBudget(new Headers(), 1).remaining).toBeNull();
  });

  it("reads typed mutation errors", () => {
    expect(mutationFailed({ __typename: "PostActionSuccess" })).toBeNull();
    expect(mutationFailed({ __typename: "NotFoundError", message: "No post" })).toBe(
      "NotFoundError: No post",
    );
    expect(mutationFailed(null)).toContain("no result");
  });
});
