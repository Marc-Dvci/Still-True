import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://still-true.test";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("public routes", () => {
  it("answers health with security headers", async () => {
    const response = await SELF.fetch(`${BASE}/api/health`);
    expect(await response.json()).toMatchObject({ ok: true, service: "still-true" });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("reports a signed-out session", async () => {
    expect(await (await SELF.fetch(`${BASE}/api/session`)).json()).toEqual({
      connected: false,
      configured: true,
    });
  });

  it("runs a fire drill and refuses an unknown scenario", async () => {
    const result = (await (await post("/api/drill", { scenario: "paris-2026-11-13" })).json()) as {
      counts: Record<string, number>;
    };
    expect(result.counts).toEqual({ hold: 1, review: 3, still_true: 4 });
    expect((await post("/api/drill", { scenario: "nowhere" })).status).toBe(404);
  });

  it("serves the demo shop with its structured data", async () => {
    const page = await SELF.fetch(`${BASE}/demo/shop/linen-shirt`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("https://schema.org/OutOfStock");
    expect((await SELF.fetch(`${BASE}/demo/shop/nothing`)).status).toBe(404);
  });

  it("answers unknown API paths with JSON", async () => {
    const response = await SELF.fetch(`${BASE}/api/unknown`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});

describe("signing in with Buffer", () => {
  it("redirects to Buffer with PKCE and sets an encrypted state cookie", async () => {
    const response = await SELF.fetch(`${BASE}/auth/login`, { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://auth.buffer.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe("https://still-true.test/auth/callback");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-st_oauth=.+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    expect(cookie).not.toContain(location.searchParams.get("state") ?? "unused");
  });

  it("refuses a callback that did not start here", async () => {
    const response = await SELF.fetch(`${BASE}/auth/callback?code=abc&state=forged`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=");
  });

  it("passes Buffer's own error back to the page", async () => {
    const response = await SELF.fetch(`${BASE}/auth/callback?error=access_denied&error_description=Denied`, {
      redirect: "manual",
    });
    expect(response.headers.get("location")).toBe("/?error=Denied");
  });
});

describe("local development sign-in", () => {
  it("does not exist unless switched on locally", async () => {
    expect((await SELF.fetch(`${BASE}/dev/connect`, { redirect: "manual" })).status).toBe(404);
  });
});

describe("signed-in routes", () => {
  it("refuse a request without a session", async () => {
    expect((await SELF.fetch(`${BASE}/api/me/board`)).status).toBe(401);
    expect((await post("/api/me/check", {})).status).toBe(401);
  });

  it("refuse a cross-site sign-out", async () => {
    expect((await post("/auth/logout", {}, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
});

describe("MCP endpoint", () => {
  const rpc = (body: unknown) => post("/mcp", body);

  it("initializes and lists one read-only tool", async () => {
    const init = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(init.result.serverInfo.name).toBe("still-true");
    const list = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(["check_post"]);
    expect(list.result.tools[0]?.annotations.readOnlyHint).toBe(true);
  });

  it("validates arguments and unknown tools", async () => {
    const bad = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "check_post", arguments: { text: "x" } },
      })
    ).json()) as { result: { isError: boolean } };
    expect(bad.result.isError).toBe(true);
    const unknown = (await (
      await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } })
    ).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32602);
    const method = (await (await rpc({ jsonrpc: "2.0", id: 5, method: "nope" })).json()) as {
      error: { code: number };
    };
    expect(method.error.code).toBe(-32601);
  });

  it("acknowledges notifications and rejects malformed JSON", async () => {
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const malformed = await SELF.fetch(`${BASE}/mcp`, { method: "POST", body: "{" });
    expect(malformed.status).toBe(400);
    expect((await SELF.fetch(`${BASE}/mcp`)).status).toBe(405);
  });
});
