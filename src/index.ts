// Still True: a Cloudflare Worker. Static pages come from Workers Static Assets; this file serves the
// OAuth flow, the JSON API behind the board, the demo pages, the fire drill and the MCP endpoint.
import { Hono, type Context } from "hono";
import { ACCOUNT } from "./buffer/operations";
import { BufferClient } from "./buffer/client";
import { buildAuthorizeUrl, createPkcePair, exchangeCode, OAuthError, randomToken } from "./buffer/oauth";
import { oauthConfig } from "./config";
import { renderDemoPage } from "./demo/pages";
import { drillScenarios, runDrill } from "./demo/drill";
import type { Env } from "./env";
import { handleMcp } from "./mcp";
import {
  clearCookie,
  OAUTH_COOKIE,
  oauthCookie,
  readOAuthCookie,
  readSession,
  SESSION_COOKIE,
  sameOrigin,
  sessionCookie,
} from "./security/session";
import { isValidTimeZone } from "./core/time";

export { OrgDO } from "./durable/org";
export { WorldDO } from "./durable/world";

type App = { Bindings: Env; Variables: { accountId: string } };

export const app = new Hono<App>();

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

app.use("*", async (c, next) => {
  await next();
  // Responses from the static-asset binding have immutable headers: copy before adding ours.
  c.res = new Response(c.res.body, c.res);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(key, value);
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/")) {
    c.res.headers.set("Cache-Control", "no-store, private");
  }
});

function origin(c: Context<App>): string {
  return c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
}

function org(c: Context<App>, accountId: string) {
  return c.env.ORG.get(c.env.ORG.idFromName(accountId));
}

// ------------------------------------------------------------------------------------------ OAuth

app.get("/auth/login", async (c) => {
  if (!c.env.BUFFER_CLIENT_ID || !c.env.BUFFER_REDIRECT_URI) {
    return c.redirect(
      "/?error=" + encodeURIComponent("Buffer sign-in is not configured on this deployment."),
    );
  }
  const { verifier, challenge } = await createPkcePair();
  const state = randomToken(16);
  c.header("Set-Cookie", await oauthCookie(c.env.TOKEN_KEY, { state, verifier }));
  return c.redirect(buildAuthorizeUrl(oauthConfig(c.env), state, challenge));
});

app.get("/auth/callback", async (c) => {
  const pending = await readOAuthCookie(c.req.raw, c.env.TOKEN_KEY);
  c.header("Set-Cookie", clearCookie(OAUTH_COOKIE), { append: true });
  const error = c.req.query("error");
  if (error) return c.redirect("/?error=" + encodeURIComponent(c.req.query("error_description") ?? error));
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!pending || !code || !state || state !== pending.state) {
    return c.redirect(
      "/?error=" +
        encodeURIComponent("That sign-in link expired or did not start here. Please connect again."),
    );
  }
  try {
    const tokens = await exchangeCode(oauthConfig(c.env), code, pending.verifier);
    const client = new BufferClient({ token: async () => tokens.accessToken });
    const { account } = await client.request<{
      account: { id: string; name: string | null; timezone: string | null };
    }>(ACCOUNT);
    const timezone = account.timezone && isValidTimeZone(account.timezone) ? account.timezone : "UTC";
    await org(c, account.id).connectAccount(
      { id: account.id, name: account.name ?? "Buffer account", timezone },
      tokens,
    );
    c.header("Set-Cookie", await sessionCookie(c.env.SESSION_SECRET, account.id), { append: true });
    return c.redirect("/board");
  } catch (err) {
    const message = err instanceof OAuthError ? err.message : "Buffer could not complete the connection.";
    console.error(JSON.stringify({ event: "oauth_failed", message: (err as Error).message }));
    return c.redirect("/?error=" + encodeURIComponent(message));
  }
});

app.post("/auth/logout", async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: "Cross-site request refused" }, 403);
  c.header("Set-Cookie", clearCookie(SESSION_COOKIE));
  return c.json({ connected: false });
});

// ------------------------------------------------------------------------------------------ public API

app.get("/api/health", (c) => c.json({ ok: true, demo: c.env.DEMO === "1", service: "still-true" }));

app.get("/api/session", async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
  return c.json({ connected: session !== null, configured: Boolean(c.env.BUFFER_CLIENT_ID) });
});

app.get("/api/drill/scenarios", (c) => c.json({ scenarios: drillScenarios() }));

app.post("/api/drill", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scenario?: string };
  const result = runDrill(body.scenario ?? "", origin(c));
  if (!result) return c.json({ error: "Unknown scenario" }, 404);
  return c.json(result);
});

app.get("/api/locations", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return c.json({ results: [] });
  const params = new URLSearchParams({ name: q, count: "6", language: "en", format: "json" });
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
      signal: AbortSignal.timeout(6_000),
    });
    const body = (await response.json()) as {
      results?: {
        name: string;
        latitude: number;
        longitude: number;
        country_code?: string;
        admin1?: string;
        timezone?: string;
      }[];
    };
    return c.json({
      results: (body.results ?? []).map((r) => ({
        name: [r.name, r.admin1].filter(Boolean).join(", "),
        latitude: r.latitude,
        longitude: r.longitude,
        country: r.country_code ?? null,
        timezone: r.timezone ?? null,
      })),
    });
  } catch {
    return c.json({ results: [] }, 502);
  }
});

app.all("/mcp", (c) => handleMcp(c.req.raw, c.env));

app.get("/demo/*", (c) => {
  const page = renderDemoPage(new URL(c.req.url).pathname, Date.now());
  if (!page) return c.notFound();
  return c.html(page.html);
});

// ------------------------------------------------------------------------------------------ signed-in API

app.use("/api/me/*", async (c, next) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
  if (!session) return c.json({ error: "Connect your Buffer account first." }, 401);
  if (c.req.method !== "GET" && !sameOrigin(c.req.raw))
    return c.json({ error: "Cross-site request refused" }, 403);
  c.set("accountId", session.accountId);
  await next();
});

app.get("/api/me/board", async (c) => c.json(await org(c, c.get("accountId")).board()));

app.post("/api/me/check", async (c) => {
  try {
    return c.json(await org(c, c.get("accountId")).checkNow());
  } catch (error) {
    return c.json({ error: (error as Error).message }, 502);
  }
});

app.post("/api/me/posts/:id/release", async (c) =>
  c.json(await org(c, c.get("accountId")).release(c.req.param("id"))),
);

app.post("/api/me/posts/:id/fix", async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (!code) return c.json({ ok: false, message: "Missing finding code" }, 400);
  return c.json(await org(c, c.get("accountId")).applyFix(c.req.param("id"), code));
});

app.post("/api/me/posts/:id/dismiss", async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (!code) return c.json({ ok: false }, 400);
  return c.json(await org(c, c.get("accountId")).dismiss(c.req.param("id"), code));
});

app.post("/api/me/posts/:id/suggest", async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (!code) return c.json({ text: null, reason: "Missing finding code" }, 400);
  return c.json(await org(c, c.get("accountId")).suggest(c.req.param("id"), code));
});

app.post("/api/me/drill", async (c) => {
  const { scenario } = (await c.req.json().catch(() => ({}))) as { scenario?: string };
  const result = await org(c, c.get("accountId")).drill(scenario ?? "", origin(c));
  if (!result) return c.json({ error: "Unknown scenario" }, 404);
  return c.json(result);
});

app.get("/api/me/settings", async (c) => c.json(await org(c, c.get("accountId")).getSettings()));

app.put("/api/me/settings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  if (typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country)) next.country = body.country;
  if (body.policy === "hold" || body.policy === "notes") next.policy = body.policy;
  if (body.location === null) next.location = null;
  const loc = body.location as { name?: unknown; latitude?: unknown; longitude?: unknown } | undefined;
  if (
    loc &&
    typeof loc.name === "string" &&
    typeof loc.latitude === "number" &&
    typeof loc.longitude === "number"
  ) {
    if (Math.abs(loc.latitude) <= 90 && Math.abs(loc.longitude) <= 180) {
      next.location = { name: loc.name.slice(0, 120), latitude: loc.latitude, longitude: loc.longitude };
    }
  }
  return c.json(await org(c, c.get("accountId")).updateSettings(next));
});

app.post("/api/me/samples", async (c) => {
  const { channelId } = (await c.req.json().catch(() => ({}))) as { channelId?: string };
  if (!channelId) return c.json({ created: 0, messages: ["Choose a channel"] }, 400);
  return c.json(await org(c, c.get("accountId")).createSamples(channelId));
});

app.post("/api/me/disconnect", async (c) => {
  await org(c, c.get("accountId")).disconnect();
  c.header("Set-Cookie", clearCookie(SESSION_COOKIE));
  return c.json({ connected: false, deleted: true });
});

// ------------------------------------------------------------------------------------------ static pages

const PAGES: Record<string, string> = {
  "/board": "/board.html",
  "/drill": "/drill.html",
  "/privacy": "/privacy.html",
  "/about": "/about.html",
};
for (const [path, file] of Object.entries(PAGES)) {
  app.get(path, (c) => c.env.ASSETS.fetch(new Request(new URL(file, c.req.url), c.req.raw)));
}

app.notFound((c) =>
  c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.env.ASSETS.fetch(c.req.raw),
);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
