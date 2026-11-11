// A stateless MCP server (Streamable HTTP, JSON responses) with one tool, `check_post`: an agent that
// drafts posts for Buffer can ask Still True before it schedules one. Same decision core as the board.
import { checkPost } from "./core/check";
import { countryForTimeZone } from "./core/country";
import { extractLinks } from "./core/links";
import { remembranceDays } from "./core/remembrance";
import { isValidTimeZone } from "./core/time";
import type { CheckContext, PageFacts } from "./core/types";
import type { Env } from "./env";
import { pageFactsFor } from "./fetchers/pages";
import { weatherAtDue } from "./fetchers/weather";

export const MCP_PROTOCOL = "2025-06-18";

const TOOL = {
  name: "check_post",
  title: "Check a scheduled post",
  description:
    "Checks a social post against the day it will go out: weekday and date errors, relative days, times already passed, broken links, out-of-stock products, changed prices, cancelled or moved events, the weather forecast, national remembrance days and active disasters or major news in the audience's country. Returns a verdict (still_true, review or hold) and each finding with its evidence.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The post text." },
      due_at: { type: "string", description: "When it will go out, ISO 8601 with offset." },
      timezone: { type: "string", description: "IANA timezone of the channel, e.g. Europe/Paris." },
      country: { type: "string", description: "ISO 3166-1 alpha-2 code of the audience. Defaults from the timezone." },
      created_at: { type: "string", description: "When the post was written (ISO 8601). Defaults to now." },
      latitude: { type: "number", description: "Business location, for the weather check." },
      longitude: { type: "number", description: "Business location, for the weather check." },
    },
    required: ["text", "due_at", "timezone"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
};

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function reply(id: RpcRequest["id"], result: unknown): unknown {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function fail(id: RpcRequest["id"], code: number, message: string): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function runCheckTool(args: Record<string, unknown>, env: Env, now = Date.now()) {
  const text = typeof args.text === "string" ? args.text.slice(0, 5_000) : "";
  const dueAt = typeof args.due_at === "string" && !Number.isNaN(Date.parse(args.due_at)) ? args.due_at : null;
  const timezone = typeof args.timezone === "string" && isValidTimeZone(args.timezone) ? args.timezone : null;
  if (!text || !dueAt || !timezone) {
    return { isError: true, content: [{ type: "text", text: "text, due_at (ISO 8601) and a valid IANA timezone are required." }] };
  }
  const country =
    typeof args.country === "string" && /^[A-Za-z]{2}$/.test(args.country)
      ? args.country.toUpperCase()
      : (countryForTimeZone(timezone) ?? "US");
  const links = extractLinks(text, null).slice(0, 3);
  const pages: Record<string, PageFacts> = {};
  for (const url of links) pages[url] = await pageFactsFor(url, { origin: env.PUBLIC_ORIGIN ?? null });
  const world = await env.WORLD.get(env.WORLD.idFromName("world")).snapshot();
  const lat = typeof args.latitude === "number" ? args.latitude : null;
  const lon = typeof args.longitude === "number" ? args.longitude : null;
  const weather = lat !== null && lon !== null ? await weatherAtDue(lat, lon, dueAt, timezone, { now }) : null;
  const ctx: CheckContext = { country, pages, weather, gdacs: world.gdacs, news: world.news, remembrance: remembranceDays() };
  const createdAt = typeof args.created_at === "string" && !Number.isNaN(Date.parse(args.created_at)) ? args.created_at : new Date(now).toISOString();
  const result = checkPost({ text, dueAt, createdAt, firstSeenDueAt: null, service: "unknown", timezone, links }, ctx);
  const summary =
    result.verdict === "still_true"
      ? "Still true: nothing in the post contradicts the day it goes out."
      : result.findings.map((f) => `${f.verdict.toUpperCase()} · ${f.title}: ${f.detail}${f.fix ? ` Suggested fix: ${f.fix.summary}.` : ""}`).join("\n");
  return { content: [{ type: "text", text: summary }], structuredContent: result };
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return new Response("Still True MCP endpoint. POST JSON-RPC 2.0 messages (Streamable HTTP).", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  let body: RpcRequest | RpcRequest[];
  try {
    body = (await request.json()) as RpcRequest | RpcRequest[];
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const out: unknown[] = [];
  for (const msg of messages) {
    if (msg.id === undefined) continue; // notifications get no reply
    switch (msg.method) {
      case "initialize":
        out.push(
          reply(msg.id, {
            protocolVersion: MCP_PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "still-true", title: "Still True", version: "1.0.0" },
            instructions: "Call check_post before scheduling a post through Buffer; hold or fix anything that is not still_true.",
          }),
        );
        break;
      case "ping":
        out.push(reply(msg.id, {}));
        break;
      case "tools/list":
        out.push(reply(msg.id, { tools: [TOOL] }));
        break;
      case "tools/call": {
        const name = msg.params?.name;
        if (name !== TOOL.name) {
          out.push(fail(msg.id, -32602, `Unknown tool: ${String(name)}`));
          break;
        }
        out.push(reply(msg.id, await runCheckTool((msg.params?.arguments as Record<string, unknown>) ?? {}, env)));
        break;
      }
      default:
        out.push(fail(msg.id, -32601, `Method not found: ${String(msg.method)}`));
    }
  }
  if (out.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}
