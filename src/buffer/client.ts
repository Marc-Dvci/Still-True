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
}

export interface BufferClientOptions {
  /** Returns a valid access token; refreshing is the caller's job (one owner per refresh token). */
  token: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onBudget?: (budget: RateBudget) => void;
}

export function parseRateBudget(headers: Headers, now: number): RateBudget {
  // Buffer sends `RateLimit: limit=100, remaining=97, reset=812` (structured field) or separate headers.
  const combined = headers.get("ratelimit");
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
