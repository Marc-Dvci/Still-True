// A small client for https://api.buffer.com. It turns Buffer's three failure shapes into typed errors:
// HTTP 401 (token rejected), HTTP 429 (rate limit, with Retry-After), and GraphQL `errors` in a 200 body.
// Typed mutation errors (`... on MutationError`) stay in `data` and are handled by the caller.

export const BUFFER_API_URL = "https://api.buffer.com";

export class BufferAuthError extends Error {
  override name = "BufferAuthError";
}

export class BufferRateLimitError extends Error {
  override name = "BufferRateLimitError";
  constructor(
    readonly retryAfterSeconds: number,
    readonly window: string | null,
  ) {
    super(`Buffer rate limit reached; retry after ${retryAfterSeconds}s`);
  }
}

export class BufferApiError extends Error {
  override name = "BufferApiError";
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

/** What the last response said about the remaining request budget (RateLimit headers, RFC draft). */
export interface RateBudget {
  remaining: number | null;
  limit: number | null;
  resetSeconds: number | null;
  observedAt: number;
  /** The window the numbers belong to ("15m", "24h", "30d"), when Buffer names it. */
  window?: string;
}

export interface BufferClientOptions {
  /** Returns a valid access token; refreshing is the caller's job (one owner per refresh token). */
  token: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onBudget?: (budget: RateBudget) => void;
}

export function parseRateBudget(headers: Headers, now: number): RateBudget {
  // Buffer (recorded 11 Nov 2026) names one member per window:
  //   RateLimit: "15m"; r=87; t=650, "24h"; r=262; t=70249, "30d"; r=662; t=2575849
  //   RateLimit-Policy: "15m"; q=150; w=900, "24h"; q=600; w=86400, "30d"; q=1000; w=2592000
  // The budget that matters is the window with the fewest requests left.
  const combined = headers.get("ratelimit");
  if (combined && /\br=\d+/.test(combined)) {
    const quotas = new Map<string, number>();
    for (const m of (headers.get("ratelimit-policy") ?? "").matchAll(/"([^"]+)"[^,]*?\bq=(\d+)/g)) {
      quotas.set(m[1] as string, Number(m[2]));
    }
    let tightest: RateBudget | null = null;
    for (const m of combined.matchAll(/"([^"]+)"[^,]*?\br=(\d+)(?:[^,]*?\bt=(\d+))?/g)) {
      const remaining = Number(m[2]);
      if (tightest === null || remaining < (tightest.remaining ?? Infinity)) {
        const window = m[1] as string;
        tightest = {
          remaining,
          limit: quotas.get(window) ?? null,
          resetSeconds: m[3] ? Number(m[3]) : null,
          observedAt: now,
          window,
        };
      }
    }
    if (tightest) return tightest;
  }
  // Other forms: `RateLimit: limit=100, remaining=97, reset=812`, or separate headers.
  const read = (key: string): number | null => {
    if (combined) {
      const match = new RegExp(`${key}=(\\d+)`).exec(combined);
      if (match?.[1]) return Number(match[1]);
    }
    const single = headers.get(`ratelimit-${key}`) ?? headers.get(`x-ratelimit-${key}`);
    return single !== null && /^\d+$/.test(single) ? Number(single) : null;
  };
  return { limit: read("limit"), remaining: read("remaining"), resetSeconds: read("reset"), observedAt: now };
}

export class BufferClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  requests = 0;

  constructor(private readonly options: BufferClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const token = await this.options.token();
    this.requests += 1;
    const response = await this.fetchImpl(BUFFER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "StillTrue/1.0 (+https://still-true.chatisthisreal.workers.dev)",
      },
      body: JSON.stringify({ query, variables }),
    });
    this.options.onBudget?.(parseRateBudget(response.headers, this.now()));

    if (response.status === 401) throw new BufferAuthError("Buffer rejected the access token");

    const body = (await response.json().catch(() => null)) as {
      data?: T;
      errors?: { message?: string; extensions?: { code?: string; window?: string } }[];
    } | null;
    const first = body?.errors?.[0];

    if (response.status === 429 || first?.extensions?.code === "RATE_LIMIT_EXCEEDED") {
      const retryAfter = Number(response.headers.get("retry-after")) || 60;
      throw new BufferRateLimitError(retryAfter, first?.extensions?.window ?? null);
    }
    if (first?.extensions?.code === "UNAUTHENTICATED" || first?.extensions?.code === "UNAUTHORIZED") {
      throw new BufferAuthError(first.message ?? "Buffer rejected the access token");
    }
    if (!response.ok || first || !body?.data) {
      throw new BufferApiError(
        first?.message ?? `Buffer answered HTTP ${response.status}`,
        first?.extensions?.code ?? null,
        response.status,
      );
    }
    return body.data;
  }
}

/** A mutation result union: success types carry data, every error type implements MutationError. */
export interface MutationResult {
  __typename: string;
  message?: string;
}

export function mutationFailed(result: MutationResult | null | undefined): string | null {
  if (!result) return "Buffer returned no result";
  if (typeof result.message === "string") return `${result.__typename}: ${result.message}`;
  return null;
}
