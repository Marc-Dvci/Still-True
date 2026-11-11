import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrgDO } from "../../src/durable/org";
import { bufferPost, demo, fakeBuffer } from "./fake-buffer";

const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();
const tokens = (expiresAt = Date.now() + 3_600_000) => ({
  accessToken: "access-0",
  refreshToken: "refresh-0",
  scope: "posts:read posts:write notes:write offline_access",
  expiresAt,
});

function account(name: string) {
  return env.ORG.get(env.ORG.idFromName(name));
}

afterEach(() => vi.unstubAllGlobals());

describe("the check cycle against Buffer", () => {
  it("holds an out-of-stock post, explains it in Buffer, and leaves a healthy post alone", async () => {
    const due = inAnHour();
    const fake = fakeBuffer([
      bufferPost("p-oos", `Back in stock: linen shirt, €49 ${demo("/demo/shop/linen-shirt")}`, due),
      bufferPost("p-ok", "New loaves every morning.", due),
    ]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("cycle-1");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    const board = await org.checkNow();

    const held = board.posts.find((p) => p.id === "p-oos");
    expect(held?.status).toBe("held");
    expect(held?.findings.map((f) => f.code)).toEqual(["out_of_stock"]);
    expect(board.posts.find((p) => p.id === "p-ok")?.verdict).toBe("still_true");

    const hold = fake.calls.find((c) => c.operation === "Hold");
    expect(hold?.variables).toEqual({
      id: "p-oos",
      text: `Back in stock: linen shirt, €49 ${demo("/demo/shop/linen-shirt")}`,
      tagIds: ["tag-held"],
    });
    const note = fake.calls.find((c) => c.operation === "AddNote");
    expect(note?.variables.postId).toBe("p-oos");
    expect(String(note?.variables.text)).toContain("moved this post to drafts");
    expect(fake.calls.filter((c) => c.variables.id === "p-ok" || c.variables.postId === "p-ok")).toEqual([]);
    expect(board.ledger.map((e) => e.event)).toEqual(expect.arrayContaining(["held", "noted", "connected"]));
  });

  it("does not hold again a post it already explained", async () => {
    const fake = fakeBuffer([
      bufferPost("p1", `Back in stock ${demo("/demo/shop/linen-shirt")}`, inAnHour()),
    ]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("cycle-2");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.checkNow();
    await org.checkNow();
    expect(fake.calls.filter((c) => c.operation === "Hold")).toHaveLength(1);
    expect(fake.calls.filter((c) => c.operation === "AddNote")).toHaveLength(1);
  });

  it("only writes notes in 'notes' mode, and never holds", async () => {
    const fake = fakeBuffer([
      bufferPost("p1", `Back in stock ${demo("/demo/shop/linen-shirt")}`, inAnHour()),
    ]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("cycle-3");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.updateSettings({ policy: "notes" });
    await org.checkNow();
    expect(fake.calls.some((c) => c.operation === "Hold")).toBe(false);
    expect(fake.calls.some((c) => c.operation === "AddNote")).toBe(true);
  });

  it("releases a held post at its original time and drops the held tag", async () => {
    const due = inAnHour();
    const fake = fakeBuffer([bufferPost("p1", `Back in stock ${demo("/demo/shop/linen-shirt")}`, due)]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("cycle-4");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.checkNow();
    fake.posts[0] = { ...fake.posts[0], tags: [{ id: "tag-held", name: "Still True: held" }] };
    const result = await org.release("p1");
    expect(result.ok).toBe(true);
    expect(fake.calls.find((c) => c.operation === "Release")?.variables).toEqual({
      id: "p1",
      text: `Back in stock ${demo("/demo/shop/linen-shirt")}`,
      dueAt: due,
      tagIds: [],
    });
    expect(await org.release("unknown")).toMatchObject({ ok: false });
  });

  it("applies a deterministic fix to the post's text", async () => {
    const fake = fakeBuffer([
      bufferPost("p1", "Open studio on Friday 14 November 2026, free entry.", inAnHour()),
    ]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("cycle-5");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.checkNow();
    const result = await org.applyFix("p1", "weekday_date_mismatch");
    expect(result.ok).toBe(true);
    expect(fake.calls.find((c) => c.operation === "EditText")?.variables.text).toBe(
      "Open studio on Saturday 14 November 2026, free entry.",
    );
    expect(await org.applyFix("p1", "price_changed")).toMatchObject({ ok: false });
  });

  it("keeps a dismissed finding out of later checks", async () => {
    const fake = fakeBuffer([bufferPost("p1", "Open studio on Friday 14 November 2026.", inAnHour())]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("cycle-6");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.checkNow();
    await org.dismiss("p1", "weekday_date_mismatch");
    const board = await org.checkNow();
    expect(board.posts[0]?.verdict).toBe("still_true");
  });
});

describe("Buffer's rules for edits", () => {
  it("sends the post's text with every edit, as Buffer requires", async () => {
    const fake = fakeBuffer([
      bufferPost("p1", `Back in stock ${demo("/demo/shop/linen-shirt")}`, inAnHour()),
      bufferPost("p2", "Open studio on Friday 14 November 2026.", inAnHour()),
    ]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("edits-1");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.checkNow();
    await org.release("p1");
    const edits = fake.calls.filter((c) =>
      ["Hold", "Release", "SetTags", "EditText", "Reschedule"].includes(c.operation),
    );
    expect(edits.length).toBeGreaterThanOrEqual(3);
    expect(edits.every((c) => typeof c.variables.text === "string" && c.variables.text.length > 0)).toBe(
      true,
    );
  });

  it("says 'flagged', not 'moved to drafts', when Buffer refuses the hold", async () => {
    const fake = fakeBuffer(
      [bufferPost("p1", `Back in stock ${demo("/demo/shop/linen-shirt")}`, inAnHour())],
      {
        holdFails: true,
      },
    );
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("edits-2");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    const board = await org.checkNow();
    const note = String(fake.calls.find((c) => c.operation === "AddNote")?.variables.text);
    expect(note).toContain("flagged this post");
    expect(note).not.toContain("moved this post to drafts");
    expect(board.posts[0]?.status).toBe("scheduled");
    expect(board.ledger.map((e) => e.event)).toContain("hold_failed");
  });
});

describe("tokens, the action log and disconnecting", () => {
  it("refreshes an expired token once and keeps Buffer's replacement", async () => {
    const fake = fakeBuffer([]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("tokens-1");
    await org.connectAccount(
      { id: "acc1", name: "Test shop", timezone: "Europe/Paris" },
      tokens(Date.now() - 1000),
    );
    await org.checkNow();
    await org.checkNow();
    const refreshes = fake.tokenRequests.filter((b) => b.get("grant_type") === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.get("refresh_token")).toBe("refresh-0");
  });

  it("chains the action log by hash and detects an edited entry", async () => {
    const fake = fakeBuffer([
      bufferPost("p1", `Back in stock ${demo("/demo/shop/linen-shirt")}`, inAnHour()),
    ]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("ledger-1");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.checkNow();
    expect(await org.verifyLedger()).toMatchObject({ intact: true });
    await runInDurableObject(org, async (_instance: OrgDO, state) => {
      state.storage.sql.exec("UPDATE ledger SET detail = 'nothing happened' WHERE event = 'held'");
    });
    expect(await org.verifyLedger()).toMatchObject({ intact: false });
  });

  it("revokes the token and deletes everything on disconnect", async () => {
    const fake = fakeBuffer([]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("disconnect-1");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    await org.disconnect();
    expect(fake.tokenRequests.some((b) => b.get("token") === "refresh-0")).toBe(true);
    const board = await org.board();
    expect(board.account).toBeNull();
    expect(board.posts).toEqual([]);
  });

  it("keeps checking when the world's sources are down", async () => {
    const fake = fakeBuffer([bufferPost("p1", "Good morning!", inAnHour())], { world: "down" });
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("world-down");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    const board = await org.checkNow();
    expect(board.posts).toHaveLength(1);
  });

  it("creates the five sample drafts as drafts", async () => {
    const fake = fakeBuffer([]);
    vi.stubGlobal("fetch", fake.fetch);
    const org = account("samples-1");
    await org.connectAccount({ id: "acc1", name: "Test shop", timezone: "Europe/Paris" }, tokens());
    const result = await org.createSamples("ch1");
    expect(result.created).toBe(5);
    const drafts = fake.calls.filter((c) => c.operation === "CreateDraft");
    expect(drafts.every((c) => (c.variables.input as { saveToDraft: boolean }).saveToDraft === true)).toBe(
      true,
    );
  });
});
