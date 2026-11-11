// One Durable Object per connected Buffer account. It is the only owner of that account's refresh
// token (Buffer rotates refresh tokens and revokes the grant if an old one is reused), and it runs the
// check cycle on its own alarm: a sweep every few hours, then a re-check 60 and 10 minutes before
// each post is due.
import { DurableObject } from "cloudflare:workers";
import {
  BufferAuthError,
  BufferClient,
  BufferRateLimitError,
  mutationFailed,
  type MutationResult,
  type RateBudget,
} from "../buffer/client";
import {
  ACCOUNT,
  ADD_NOTE,
  CHANNELS,
  CREATE_DRAFT,
  CREATE_TAG,
  EDIT_TEXT,
  HOLD,
  POST,
  QUEUE,
  RELEASE,
  RESCHEDULE,
  SET_TAGS,
  TAGS,
} from "../buffer/operations";
import { refreshTokens, revokeToken, type OAuthConfig, type TokenSet } from "../buffer/oauth";
import { checkPost } from "../core/check";
import { countryForTimeZone } from "../core/country";
import { extractLinks } from "../core/links";
import { remembranceDays } from "../core/remembrance";
import type { CheckContext, CheckResult, Finding, PageFacts, PostUnderCheck } from "../core/types";
import type { Env } from "../env";
import { pageFactsFor } from "../fetchers/pages";
import { weatherAtDue } from "../fetchers/weather";
import { importAesKey, open, seal, sha256Hex } from "../security/crypto";
import { oauthConfig } from "../config";
import { sampleDrafts } from "../demo/samples";
import { suggestRewrite } from "../ai/assist";
import { runDrill, type DrillResult } from "../demo/drill";
import { localParts } from "../core/time";

export interface Settings {
  country: string;
  location: { name: string; latitude: number; longitude: number } | null;
  /** "hold": high-confidence findings move the post to drafts. "notes": never change a post, only explain. */
  policy: "hold" | "notes";
}

interface BufferPost {
  id: string;
  text: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  channelId: string;
  channelService: string;
  via: string;
  author: { name: string | null; urn: string | null } | null;
  tags: { id: string; name: string }[];
  metadata: Record<string, unknown> | null;
}

interface Channel {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  avatar: string;
  timezone: string;
  isDisconnected: boolean;
  isQueuePaused: boolean;
  isLocked: boolean;
}

interface Organization {
  id: string;
  name: string;
  channelCount: number;
}

export interface BoardPost {
  id: string;
  organizationId: string;
  channel: { id: string; name: string; service: string; avatar: string; timezone: string } | null;
  text: string;
  dueAt: string | null;
  createdAt: string;
  via: string;
  status: "scheduled" | "held" | "draft";
  verdict: CheckResult["verdict"] | "unchecked";
  findings: Finding[];
  checkedAt: string | null;
  nextCheckAt: string | null;
  heldDueAt: string | null;
  links: string[];
}

export interface BoardState {
  account: { id: string; name: string; timezone: string } | null;
  organizations: Organization[];
  channels: { id: string; name: string; service: string; organizationId: string }[];
  settings: Settings;
  posts: BoardPost[];
  ledger: { at: string; postId: string | null; event: string; detail: string }[];
  budget: { requestsToday: number; lastCycleAt: string | null; nextCycleAt: string | null; remaining: number | null };
  scopes: string;
}

const HELD_TAG = { name: "Still True: held", color: "#D7261E" };
const REVIEW_TAG = { name: "Still True: review", color: "#F2A900" };
const SWEEP_MS = 3 * 60 * 60 * 1000;
const NEAR_SWEEP_MS = 30 * 60 * 1000;
const HORIZON_MS = 7 * 86_400_000;
const MIN_GAP_MS = 60_000;
const MAX_PAGE_FETCHES = 25;

export class OrgDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private budget: RateBudget | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS posts (
        post_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        first_seen_due_at TEXT,
        due_at TEXT,
        created_at TEXT,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        via TEXT,
        links TEXT NOT NULL DEFAULT '[]',
        verdict TEXT NOT NULL DEFAULT 'unchecked',
        findings TEXT NOT NULL DEFAULT '[]',
        checked_at TEXT,
        next_check_at TEXT,
        held_at TEXT,
        held_due_at TEXT,
        released_at TEXT,
        noted TEXT NOT NULL DEFAULT '[]',
        dismissed TEXT NOT NULL DEFAULT '[]',
        seen_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
      );
      CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, facts TEXT NOT NULL, fetched_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        post_id TEXT,
        event TEXT NOT NULL,
        detail TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL
      );
    `);
  }

  // ------------------------------------------------------------------ key-value helpers

  private get<T>(key: string): T | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", key).toArray()[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private put(key: string, value: unknown): void {
    this.sql.exec(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }

  private now(): number {
    return Date.now();
  }

  // ------------------------------------------------------------------ connection and tokens

  async connectAccount(account: { id: string; name: string; timezone: string | null }, tokens: TokenSet): Promise<void> {
    await this.storeTokens(account.id, tokens);
    this.put("account", { id: account.id, name: account.name, timezone: account.timezone ?? "UTC" });
    if (!this.get<Settings>("settings")) {
      this.put("settings", {
        country: countryForTimeZone(account.timezone ?? "UTC") ?? "US",
        location: null,
        policy: "hold",
      } satisfies Settings);
    }
    await this.appendLedger(null, "connected", "Buffer account connected");
    await this.ctx.storage.setAlarm(this.now() + 2_000);
  }

  private async storeTokens(accountId: string, tokens: TokenSet): Promise<void> {
    const key = await importAesKey(this.env.TOKEN_KEY);
    this.put("tokens", {
      sealed: await seal(key, JSON.stringify(tokens), accountId),
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });
  }

  private async accessToken(): Promise<string> {
    const account = this.get<{ id: string }>("account");
    const stored = this.get<{ sealed: string; expiresAt: number }>("tokens");
    if (!account || !stored) throw new BufferAuthError("Not connected");
    const key = await importAesKey(this.env.TOKEN_KEY);
    const tokens = JSON.parse(await open(key, stored.sealed, account.id)) as TokenSet;
    if (this.now() < tokens.expiresAt) return tokens.accessToken;
    // Single-use rotating refresh token: this object is its only owner, and Durable Object input gates
    // serialise this read-refresh-write, so two refreshes can never race.
    const refreshed = await refreshTokens(oauthConfig(this.env) as OAuthConfig, tokens.refreshToken);
    await this.storeTokens(account.id, refreshed);
    return refreshed.accessToken;
  }

  private client(): BufferClient {
    return new BufferClient({
      token: () => this.accessToken(),
      onBudget: (budget) => {
        this.budget = budget;
        this.countRequest();
      },
    });
  }

  private countRequest(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const counter = this.get<{ day: string; count: number }>("requests") ?? { day, count: 0 };
    this.put("requests", counter.day === day ? { day, count: counter.count + 1 } : { day, count: 1 });
  }

  async disconnect(): Promise<void> {
    const account = this.get<{ id: string }>("account");
    const stored = this.get<{ sealed: string }>("tokens");
    if (account && stored) {
      try {
        const tokens = JSON.parse(await open(await importAesKey(this.env.TOKEN_KEY), stored.sealed, account.id)) as TokenSet;
        await revokeToken(oauthConfig(this.env) as OAuthConfig, tokens.refreshToken);
      } catch {
        // Revocation is best effort; the stored tokens are deleted either way.
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ------------------------------------------------------------------ ledger

  private async appendLedger(postId: string | null, event: string, detail: string): Promise<void> {
    const last = this.sql.exec<{ hash: string }>("SELECT hash FROM ledger ORDER BY id DESC LIMIT 1").toArray()[0];
    const prev = last?.hash ?? "0".repeat(64);
    const at = new Date(this.now()).toISOString();
    const hash = await sha256Hex(`${prev}|${at}|${postId ?? ""}|${event}|${detail}`);
    this.sql.exec(
      "INSERT INTO ledger (at, post_id, event, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
      at,
      postId,
      event,
      detail,
      prev,
      hash,
    );
  }

  async verifyLedger(): Promise<{ entries: number; intact: boolean }> {
    const rows = this.sql
      .exec<{ at: string; post_id: string | null; event: string; detail: string; prev_hash: string; hash: string }>(
        "SELECT at, post_id, event, detail, prev_hash, hash FROM ledger ORDER BY id",
      )
      .toArray();
    let prev = "0".repeat(64);
    for (const row of rows) {
      const expected = await sha256Hex(`${prev}|${row.at}|${row.post_id ?? ""}|${row.event}|${row.detail}`);
      if (row.prev_hash !== prev || row.hash !== expected) return { entries: rows.length, intact: false };
      prev = row.hash;
    }
    return { entries: rows.length, intact: true };
  }

  // ------------------------------------------------------------------ settings

  getSettings(): Settings {
    return this.get<Settings>("settings") ?? { country: "US", location: null, policy: "hold" };
  }

  async updateSettings(next: Partial<Settings>): Promise<Settings> {
    const merged = { ...this.getSettings(), ...next };
    this.put("settings", merged);
    // Settings change what is true (country, location): re-check soon.
    await this.ctx.storage.setAlarm(this.now() + 2_000);
    return merged;
  }

  // ------------------------------------------------------------------ the check cycle

  override async alarm(): Promise<void> {
    try {
      await this.cycle();
    } catch (error) {
      if (error instanceof BufferAuthError) {
        this.put("authFailed", { at: new Date(this.now()).toISOString(), message: error.message });
        return; // No alarm: the account has to reconnect.
      }
      const delay = error instanceof BufferRateLimitError ? error.retryAfterSeconds * 1000 + 5_000 : 5 * 60_000;
      console.error(JSON.stringify({ event: "cycle_failed", message: (error as Error).message }));
      await this.ctx.storage.setAlarm(this.now() + delay);
    }
  }

  async checkNow(): Promise<BoardState> {
    await this.cycle();
    return this.board();
  }

  private async cycle(): Promise<void> {
    const account = this.get<{ id: string; timezone: string }>("account");
    if (!account) return;
    const client = this.client();
    const settings = this.getSettings();
    const startedAt = this.now();

    const { account: live } = await client.request<{ account: { organizations: Organization[] } }>(ACCOUNT);
    this.put("organizations", live.organizations);

    const world = await this.env.WORLD.get(this.env.WORLD.idFromName("world")).snapshot();
    const remembrance = remembranceDays();
    let pageFetches = 0;
    const seen = new Set<string>();

    for (const org of live.organizations) {
      const channels = await this.channels(client, org.id);
      const posts = await this.queue(client, org.id, startedAt);
      const heldTag = await this.ensureTag(client, org.id, HELD_TAG);
      const reviewTag = await this.ensureTag(client, org.id, REVIEW_TAG);

      for (const post of posts) {
        if (!post.dueAt) continue;
        seen.add(post.id);
        const channel = channels.get(post.channelId);
        const timezone = channel?.timezone || account.timezone || "UTC";
        const links = extractLinks(post.text, post.metadata);
        const row = this.upsertPost(org.id, post, links);

        const pages: Record<string, PageFacts> = {};
        for (const url of links) {
          const near = Date.parse(post.dueAt) - startedAt < 2 * 60 * 60_000;
          const facts = await this.cachedPage(url, near ? 10 * 60_000 : 6 * 60 * 60_000, () => {
            pageFetches += 1;
            return pageFetches <= MAX_PAGE_FETCHES;
          });
          if (facts) pages[url] = facts;
        }

        const weather =
          settings.location !== null
            ? await weatherAtDue(settings.location.latitude, settings.location.longitude, post.dueAt, timezone, {
                cache: this.ctx.storage,
                now: startedAt,
              })
            : null;

        const context: CheckContext = {
          country: settings.country,
          pages,
          weather,
          gdacs: world.gdacs,
          news: world.news,
          remembrance,
        };
        const subject: PostUnderCheck = {
          id: post.id,
          text: post.text,
          createdAt: post.createdAt,
          dueAt: post.dueAt,
          firstSeenDueAt: row.firstSeenDueAt,
          service: post.channelService,
          timezone,
          links,
        };
        const result = checkPost(subject, context);
        const dismissed = new Set(row.dismissed);
        result.findings = result.findings.filter((f) => !dismissed.has(f.code));
        result.verdict = result.findings.some((f) => f.verdict === "hold")
          ? "hold"
          : result.findings.length
            ? "review"
            : "still_true";

        await this.act(client, org.id, post, result, row, settings, { heldTag, reviewTag });
        this.sql.exec(
          "UPDATE posts SET verdict = ?, findings = ?, checked_at = ?, next_check_at = ? WHERE post_id = ?",
          result.verdict,
          JSON.stringify(result.findings),
          new Date(this.now()).toISOString(),
          new Date(this.nextCheckFor(post.dueAt, this.now())).toISOString(),
          post.id,
        );
      }
    }

    // Rows for posts no longer scheduled (published, deleted, moved out of the horizon) are dropped
    // unless Still True is holding them.
    const known = this.sql.exec<{ post_id: string; held_at: string | null }>("SELECT post_id, held_at FROM posts").toArray();
    for (const { post_id, held_at } of known) {
      if (!seen.has(post_id) && !held_at) this.sql.exec("DELETE FROM posts WHERE post_id = ?", post_id);
    }

    this.put("lastCycle", {
      at: new Date(startedAt).toISOString(),
      requests: client.requests,
      pageFetches: Math.min(pageFetches, MAX_PAGE_FETCHES),
    });
    await this.scheduleNext();
  }

  private async channels(client: BufferClient, organizationId: string): Promise<Map<string, Channel>> {
    const cacheKey = `channels:${organizationId}`;
    const cached = this.get<{ at: number; channels: Channel[] }>(cacheKey);
    let channels = cached && this.now() - cached.at < 60 * 60_000 ? cached.channels : null;
    if (!channels) {
      const data = await client.request<{ channels: Channel[] }>(CHANNELS, { organizationId });
      channels = data.channels;
      this.put(cacheKey, { at: this.now(), channels });
    }
    return new Map(channels.map((c) => [c.id, c]));
  }

  private async queue(client: BufferClient, organizationId: string, now: number): Promise<BufferPost[]> {
    const posts: BufferPost[] = [];
    let after: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const data: {
        posts: { edges: { node: BufferPost }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      } = await client.request(QUEUE, {
        organizationId,
        status: ["scheduled", "draft"],
        start: new Date(now).toISOString(),
        end: new Date(now + HORIZON_MS).toISOString(),
        after,
      });
      posts.push(...data.posts.edges.map((e) => e.node));
      if (!data.posts.pageInfo.hasNextPage) break;
      after = data.posts.pageInfo.endCursor;
    }
    return posts;
  }

  private async ensureTag(
    client: BufferClient,
    organizationId: string,
    tag: { name: string; color: string },
  ): Promise<string | null> {
    const cacheKey = `tag:${organizationId}:${tag.name}`;
    const cached = this.get<string | false>(cacheKey);
    if (cached !== null) return cached || null;
    try {
      const data = await client.request<{ tagsV2: { edges: { node: { id: string; name: string } }[] } }>(TAGS, {
        organizationId,
      });
      const existing = data.tagsV2.edges.find((e) => e.node.name === tag.name);
      if (existing) {
        this.put(cacheKey, existing.node.id);
        return existing.node.id;
      }
      const created = await client.request<{ createTag: MutationResult & { tag?: { id: string } } }>(CREATE_TAG, {
        organizationId,
        name: tag.name,
        color: tag.color,
      });
      const id = created.createTag.tag?.id ?? null;
      this.put(cacheKey, id ?? false);
      return id;
    } catch {
      this.put(cacheKey, false);
      return null;
    }
  }

  private upsertPost(
    organizationId: string,
    post: BufferPost,
    links: string[],
  ): { firstSeenDueAt: string | null; dismissed: string[]; noted: string[]; heldAt: string | null } {
    const existing = this.sql
      .exec<{ first_seen_due_at: string | null; dismissed: string; noted: string; held_at: string | null }>(
        "SELECT first_seen_due_at, dismissed, noted, held_at FROM posts WHERE post_id = ?",
        post.id,
      )
      .toArray()[0];
    const now = new Date(this.now()).toISOString();
    if (!existing) {
      this.sql.exec(
        `INSERT INTO posts (post_id, org_id, channel_id, first_seen_due_at, due_at, created_at, text, text_hash, via, links, seen_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
        post.id,
        organizationId,
        post.channelId,
        post.dueAt,
        post.dueAt,
        post.createdAt,
        post.text,
        post.via,
        JSON.stringify(links),
        now,
        post.status,
      );
      // First sight: there is no earlier due time to compare with.
      return { firstSeenDueAt: null, dismissed: [], noted: [], heldAt: null };
    }
    // A post that is scheduled again (released here or rescheduled in Buffer) is no longer held.
    this.sql.exec(
      "UPDATE posts SET due_at = ?, text = ?, links = ?, channel_id = ?, status = ?, held_at = CASE WHEN ? = 'scheduled' THEN NULL ELSE held_at END WHERE post_id = ?",
      post.dueAt,
      post.text,
      JSON.stringify(links),
      post.channelId,
      post.status,
      post.status,
      post.id,
    );
    return {
      firstSeenDueAt: existing.first_seen_due_at,
      dismissed: JSON.parse(existing.dismissed) as string[],
      noted: JSON.parse(existing.noted) as string[],
      heldAt: existing.held_at,
    };
  }

  private async cachedPage(url: string, ttlMs: number, allowFetch: () => boolean): Promise<PageFacts | null> {
    const row = this.sql
      .exec<{ facts: string; fetched_at: number; failures: number }>(
        "SELECT facts, fetched_at, failures FROM pages WHERE url = ?",
        url,
      )
      .toArray()[0];
    if (row && this.now() - row.fetched_at < ttlMs) return JSON.parse(row.facts) as PageFacts;
    if (!allowFetch()) return row ? (JSON.parse(row.facts) as PageFacts) : null;
    const facts = await pageFactsFor(url, { origin: this.env.PUBLIC_ORIGIN ?? null });
    // A 5xx counts as dead only on the second consecutive failure.
    const failures = facts.status >= 500 ? (row?.failures ?? 0) + 1 : 0;
    const effective = facts.status >= 500 && failures < 2 ? { ...facts, status: 200 } : facts;
    this.sql.exec(
      `INSERT INTO pages (url, facts, fetched_at, failures) VALUES (?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET facts = excluded.facts, fetched_at = excluded.fetched_at, failures = excluded.failures`,
      url,
      JSON.stringify(effective),
      this.now(),
      failures,
    );
    return effective;
  }

  // ------------------------------------------------------------------ acting on a result

  private async act(
    client: BufferClient,
    organizationId: string,
    post: BufferPost,
    result: CheckResult,
    row: { noted: string[]; heldAt: string | null },
    settings: Settings,
    tags: { heldTag: string | null; reviewTag: string | null },
  ): Promise<void> {
    if (result.verdict === "still_true") return;
    const noted = new Set(row.noted);
    const fresh = result.findings.filter((f) => !noted.has(findingKey(f)));
    if (fresh.length === 0) return;

    const existingTagIds = post.tags.map((t) => t.id);
    if (result.verdict === "hold" && settings.policy === "hold" && post.status === "scheduled") {
      const tagIds = tags.heldTag ? unique([...existingTagIds, tags.heldTag]) : undefined;
      const held = await client.request<{ editPost: MutationResult }>(HOLD, { id: post.id, tagIds });
      const failure = mutationFailed(held.editPost);
      if (failure) {
        await this.appendLedger(post.id, "hold_failed", failure);
      } else {
        this.sql.exec(
          "UPDATE posts SET held_at = ?, held_due_at = ? WHERE post_id = ?",
          new Date(this.now()).toISOString(),
          post.dueAt,
          post.id,
        );
        await this.appendLedger(post.id, "held", `${fresh.map((f) => f.code).join(", ")}; due ${post.dueAt}`);
      }
    } else if (tags.reviewTag && !existingTagIds.includes(tags.reviewTag)) {
      await client.request(SET_TAGS, { id: post.id, tagIds: unique([...existingTagIds, tags.reviewTag]) }).catch(() => null);
    }

    const scopes = this.get<{ scope: string }>("tokens")?.scope ?? "";
    if (scopes.includes("notes:write")) {
      const text = noteText(result, fresh, settings, this.env.PUBLIC_ORIGIN ?? "", post.id);
      const note = await client
        .request<{ createCollaborationNote: MutationResult }>(ADD_NOTE, { postId: post.id, text })
        .catch((error: Error) => ({ createCollaborationNote: { __typename: "Error", message: error.message } }));
      const failure = mutationFailed(note.createCollaborationNote);
      await this.appendLedger(post.id, failure ? "note_failed" : "noted", failure ?? fresh.map((f) => f.code).join(", "));
    }
    this.sql.exec(
      "UPDATE posts SET noted = ? WHERE post_id = ?",
      JSON.stringify(unique([...noted, ...fresh.map(findingKey)])),
      post.id,
    );
  }

  // ------------------------------------------------------------------ user actions

  async release(postId: string, dueAt?: string): Promise<{ ok: boolean; message: string }> {
    const row = this.sql
      .exec<{ held_due_at: string | null; org_id: string }>("SELECT held_due_at, org_id FROM posts WHERE post_id = ?", postId)
      .toArray()[0];
    const target = dueAt ?? row?.held_due_at ?? null;
    if (!row || !target) return { ok: false, message: "This post is not held by Still True." };
    const when = Date.parse(target) < this.now() + 5 * 60_000 ? new Date(this.now() + 5 * 60_000).toISOString() : target;
    const client = this.client();
    const current = await client.request<{ post: BufferPost }>(POST, { id: postId });
    const heldTag = this.get<string | false>(`tag:${row.org_id}:${HELD_TAG.name}`);
    const tagIds = current.post.tags.map((t) => t.id).filter((id) => id !== heldTag);
    const result = await client.request<{ editPost: MutationResult }>(RELEASE, { id: postId, dueAt: when, tagIds });
    const failure = mutationFailed(result.editPost);
    if (failure) return { ok: false, message: failure };
    this.sql.exec(
      "UPDATE posts SET held_at = NULL, released_at = ?, dismissed = ? WHERE post_id = ?",
      new Date(this.now()).toISOString(),
      JSON.stringify(unique(this.findingsOf(postId).map((f) => f.code))),
      postId,
    );
    await this.appendLedger(postId, "released", `scheduled for ${when}`);
    return { ok: true, message: `Scheduled again for ${when}` };
  }

  async applyFix(postId: string, code: string): Promise<{ ok: boolean; message: string }> {
    const finding = this.findingsOf(postId).find((f) => f.code === code);
    if (!finding?.fix) return { ok: false, message: "No fix is available for this finding." };
    const client = this.client();
    if (finding.fix.kind === "replace_text" && finding.fix.text) {
      const result = await client.request<{ editPost: MutationResult }>(EDIT_TEXT, { id: postId, text: finding.fix.text });
      const failure = mutationFailed(result.editPost);
      if (failure) return { ok: false, message: failure };
    } else if (finding.fix.kind === "reschedule" && finding.fix.dueAt) {
      const result = await client.request<{ editPost: MutationResult }>(RESCHEDULE, { id: postId, dueAt: finding.fix.dueAt });
      const failure = mutationFailed(result.editPost);
      if (failure) return { ok: false, message: failure };
    }
    await this.appendLedger(postId, "fix_applied", `${code}: ${finding.fix.summary}`);
    const held = this.sql.exec<{ held_at: string | null }>("SELECT held_at FROM posts WHERE post_id = ?", postId).toArray()[0];
    if (held?.held_at) {
      // A fixed post that was held goes back to its slot (or the fix's new time).
      return this.release(postId, finding.fix.kind === "reschedule" ? finding.fix.dueAt : undefined);
    }
    await this.ctx.storage.setAlarm(this.now() + 2_000);
    return { ok: true, message: finding.fix.summary };
  }

  async dismiss(postId: string, code: string): Promise<{ ok: boolean }> {
    const row = this.sql.exec<{ dismissed: string }>("SELECT dismissed FROM posts WHERE post_id = ?", postId).toArray()[0];
    if (!row) return { ok: false };
    this.sql.exec(
      "UPDATE posts SET dismissed = ? WHERE post_id = ?",
      JSON.stringify(unique([...(JSON.parse(row.dismissed) as string[]), code])),
      postId,
    );
    await this.appendLedger(postId, "dismissed", code);
    return { ok: true };
  }

  async suggest(postId: string, code: string): Promise<{ text: string | null; reason: string }> {
    const row = this.sql.exec<{ text: string; findings: string }>("SELECT text, findings FROM posts WHERE post_id = ?", postId).toArray()[0];
    if (!row) return { text: null, reason: "Unknown post" };
    const finding = (JSON.parse(row.findings) as Finding[]).find((f) => f.code === code);
    if (!finding) return { text: null, reason: "Unknown finding" };
    return suggestRewrite(this.env.AI, row.text, finding);
  }

  async createSamples(channelId: string): Promise<{ created: number; messages: string[] }> {
    const account = this.get<{ timezone: string }>("account");
    const client = this.client();
    const messages: string[] = [];
    let created = 0;
    for (const draft of sampleDrafts(this.env.PUBLIC_ORIGIN ?? "", account?.timezone ?? "UTC", this.now())) {
      const result = await client.request<{ createPost: MutationResult }>(CREATE_DRAFT, {
        input: { channelId, text: draft.text, mode: "customScheduled", dueAt: draft.dueAt, schedulingType: "automatic", saveToDraft: true, assets: [] },
      });
      const failure = mutationFailed(result.createPost);
      if (failure) messages.push(failure);
      else created += 1;
    }
    await this.appendLedger(null, "samples_created", `${created} drafts on channel ${channelId}`);
    return { created, messages };
  }

  /** Replays the stored queue on a fire-drill day, at the same local times of day. */
  drill(scenarioId: string, origin: string): DrillResult | null {
    const channels = new Map<string, Channel>();
    for (const org of this.get<Organization[]>("organizations") ?? []) {
      for (const c of this.get<{ channels: Channel[] }>(`channels:${org.id}`)?.channels ?? []) channels.set(c.id, c);
    }
    const rows = this.sql
      .exec<{ post_id: string; text: string; due_at: string | null; channel_id: string }>(
        "SELECT post_id, text, due_at, channel_id FROM posts WHERE due_at IS NOT NULL ORDER BY due_at LIMIT 40",
      )
      .toArray();
    if (rows.length === 0) return runDrill(scenarioId, origin);
    const items = rows.map((r) => {
      const channel = channels.get(r.channel_id);
      const local = localParts(r.due_at as string, channel?.timezone || "UTC");
      return {
        id: r.post_id,
        text: r.text,
        localTime: [local.hour, local.minute] as [number, number],
        channel: { name: channel?.displayName || channel?.name || "Channel", service: channel?.service ?? "unknown" },
      };
    });
    return runDrill(scenarioId, origin, items);
  }

  // ------------------------------------------------------------------ board

  private findingsOf(postId: string): Finding[] {
    const row = this.sql.exec<{ findings: string }>("SELECT findings FROM posts WHERE post_id = ?", postId).toArray()[0];
    return row ? (JSON.parse(row.findings) as Finding[]) : [];
  }

  async board(): Promise<BoardState> {
    const account = this.get<{ id: string; name: string; timezone: string }>("account");
    const organizations = this.get<Organization[]>("organizations") ?? [];
    const channelIndex = new Map<string, Channel>();
    for (const org of organizations) {
      for (const channel of this.get<{ channels: Channel[] }>(`channels:${org.id}`)?.channels ?? []) channelIndex.set(channel.id, channel);
    }
    const rows = this.sql
      .exec<{
        post_id: string;
        org_id: string;
        channel_id: string;
        due_at: string | null;
        created_at: string;
        text: string;
        via: string;
        links: string;
        verdict: string;
        findings: string;
        checked_at: string | null;
        next_check_at: string | null;
        held_at: string | null;
        held_due_at: string | null;
        status: string;
      }>("SELECT * FROM posts ORDER BY COALESCE(held_due_at, due_at)")
      .toArray();
    const posts: BoardPost[] = rows.map((r) => {
      const channel = channelIndex.get(r.channel_id);
      return {
        id: r.post_id,
        organizationId: r.org_id,
        channel: channel
          ? { id: channel.id, name: channel.displayName || channel.name, service: channel.service, avatar: channel.avatar, timezone: channel.timezone }
          : null,
        text: r.text,
        dueAt: r.held_due_at ?? r.due_at,
        createdAt: r.created_at,
        via: r.via,
        status: r.held_at ? "held" : r.status === "draft" ? "draft" : "scheduled",
        verdict: r.verdict as BoardPost["verdict"],
        findings: JSON.parse(r.findings) as Finding[],
        checkedAt: r.checked_at,
        nextCheckAt: r.next_check_at,
        heldDueAt: r.held_due_at,
        links: JSON.parse(r.links) as string[],
      };
    });
    const ledger = this.sql
      .exec<{ at: string; post_id: string | null; event: string; detail: string }>(
        "SELECT at, post_id, event, detail FROM ledger ORDER BY id DESC LIMIT 30",
      )
      .toArray()
      .map((e) => ({ at: e.at, postId: e.post_id, event: e.event, detail: e.detail }));
    const requests = this.get<{ day: string; count: number }>("requests");
    const today = new Date(this.now()).toISOString().slice(0, 10);
    const alarm = await this.ctx.storage.getAlarm();
    const channels: BoardState["channels"] = [];
    for (const org of organizations) {
      for (const c of this.get<{ channels: Channel[] }>(`channels:${org.id}`)?.channels ?? []) {
        if (!c.isDisconnected && !c.isLocked) channels.push({ id: c.id, name: c.displayName || c.name, service: c.service, organizationId: org.id });
      }
    }
    return {
      account,
      organizations,
      channels,
      settings: this.getSettings(),
      posts,
      ledger,
      budget: {
        requestsToday: requests?.day === today ? requests.count : 0,
        lastCycleAt: this.get<{ at: string }>("lastCycle")?.at ?? null,
        nextCycleAt: alarm ? new Date(alarm).toISOString() : null,
        remaining: this.budget?.remaining ?? null,
      },
      scopes: this.get<{ scope: string }>("tokens")?.scope ?? "",
    };
  }

  // ------------------------------------------------------------------ scheduling

  private nextCheckFor(dueAt: string, now: number): number {
    const due = Date.parse(dueAt);
    const candidates = [due - 60 * 60_000, due - 10 * 60_000].filter((t) => t > now + MIN_GAP_MS);
    return candidates.length ? Math.min(...candidates) : due;
  }

  private async scheduleNext(): Promise<void> {
    const now = this.now();
    const dues = this.sql
      .exec<{ due_at: string }>("SELECT due_at FROM posts WHERE held_at IS NULL AND due_at IS NOT NULL")
      .toArray()
      .map((r) => Date.parse(r.due_at))
      .filter((t) => t > now);
    const soon = dues.some((t) => t - now < 3 * 60 * 60_000);
    let next = now + (soon ? NEAR_SWEEP_MS : SWEEP_MS);
    for (const due of dues) {
      for (const checkpoint of [due - 60 * 60_000, due - 10 * 60_000]) {
        if (checkpoint > now + MIN_GAP_MS && checkpoint < next) next = checkpoint;
      }
    }
    await this.ctx.storage.setAlarm(next);
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function findingKey(finding: Finding): string {
  return `${finding.code}:${finding.evidence.map((e) => e.value).join("|")}`;
}

export function noteText(
  result: CheckResult,
  findings: Finding[],
  settings: Settings,
  origin: string,
  postId: string,
): string {
  const head =
    result.verdict === "hold" && settings.policy === "hold"
      ? "Still True moved this post to drafts before it went out."
      : "Still True flagged this post for a second look.";
  const lines = findings.map((f) => `• ${f.title}: ${f.detail}`);
  const link = origin ? `Review, fix or release it: ${origin}/board#post-${postId}` : "";
  return [head, ...lines, link].filter(Boolean).join("\n");
}
