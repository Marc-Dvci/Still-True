// Live check against the real Buffer API, on a channel of your own account.
//
// It creates two scheduled posts four days out (one links to the demo shop's out-of-stock shirt, one
// names the wrong weekday), lets a running Still True (`wrangler dev --env e2e` with DEV_KEY_LOGIN=1) check
// the queue, reads Buffer back to see the hold, the tag and the note, releases the held post, applies the
// weekday fix, then deletes both posts. Nothing is published.
//
//   BUFFER_API_KEY=... npx tsx scripts/live_check.ts <channelId> [http://127.0.0.1:8788]
//
// Writes docs/LIVE.md and test/fixtures/buffer/*.json (Buffer's own responses, with ids replaced).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACCOUNT, CHANNELS, POST, QUEUE } from "../src/buffer/operations";
import {
  addDays,
  localParts,
  localToInstant,
  MONTH_NAMES_EN,
  parseDateKey,
  weekdayOf,
  WEEKDAY_NAMES_EN,
} from "../src/core/time";

const KEY = process.env.BUFFER_API_KEY;
const CHANNEL = process.argv[2];
const APP = process.argv[3] ?? "http://127.0.0.1:8788";
const PUBLIC = "https://still-true.chatisthisreal.workers.dev";
if (!KEY || !CHANNEL) {
  console.error("Usage: BUFFER_API_KEY=... npx tsx scripts/live_check.ts <channelId> [app-url]");
  process.exit(1);
}
const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(root, "test/fixtures/buffer");
mkdirSync(fixtures, { recursive: true });

const log: string[] = [];
const note = (line: string) => {
  log.push(line);
  console.log(line);
};

async function buffer<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data: T; ms: number }> {
  const t0 = performance.now();
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (!body.data || body.errors?.length) throw new Error(`Buffer: ${JSON.stringify(body.errors ?? body)}`);
  return { data: body.data, ms: Math.round(performance.now() - t0) };
}

const ids = new Map<string, string>();
function scrub(value: unknown): unknown {
  // Replace every Buffer id with a stable placeholder so the fixtures carry shapes, not account data.
  return JSON.parse(
    JSON.stringify(value)
      .replace(/\b([0-9a-f]{24})\b/g, (_m, id: string) => {
        if (!ids.has(id)) ids.set(id, `id-${String(ids.size + 1).padStart(3, "0")}`);
        return ids.get(id) as string;
      })
      // Account, channel and author names; Still True's own tag names stay.
      .replace(/"(name|displayName)":"(?!Still True)[^"]*"/g, '"$1":"Test account"'),
  );
}
const record = (name: string, data: unknown) =>
  writeFileSync(resolve(fixtures, `${name}.json`), `${JSON.stringify(scrub(data), null, 1)}\n`);

const CREATE = /* GraphQL */ `
  mutation LiveCreate($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          dueAt
          text
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation LiveDelete($id: PostId!) {
    deletePost(input: { id: $id }) {
      __typename
      ... on DeletePostSuccess {
        id
      }
      ... on MutationError {
        message
      }
    }
  }
`;
const NOTES = /* GraphQL */ `
  query LiveNotes($postId: PostId!) {
    collaborationNotes(first: 10, input: { subject: { postId: $postId } }) {
      edges {
        node {
          id
          text
          createdAt
        }
      }
    }
  }
`;

const tz = "Europe/Paris";
const now = Date.now();
const day = addDays(localParts(now, tz).date, 4);
const dueA = localToInstant(day, 10, 0, tz).toISOString();
const dueB = localToInstant(day, 11, 30, tz).toISOString();
const eventDay = addDays(day, 1);
const wrong = WEEKDAY_NAMES_EN[(weekdayOf(eventDay) + 5) % 7] as string;
const { day: d, month: m } = parseDateKey(eventDay);
const textA = `Back in stock: our natural linen shirt, €49 ${PUBLIC}/demo/shop/linen-shirt`;
const textB = `Open studio on ${wrong} ${d} ${MONTH_NAMES_EN[m - 1]}: meet the makers, free entry.`;

note(`# Live check, ${new Date(now).toISOString()}`);
const account = await buffer<{ account: { organizations: { id: string }[] } }>(ACCOUNT);
record("account", account.data);
const organizationId = account.data.account.organizations[0]?.id as string;
const channels = await buffer(CHANNELS, { organizationId });
record("channels", channels.data);

const created: string[] = [];
try {
  for (const [text, dueAt] of [
    [textA, dueA],
    [textB, dueB],
  ] as const) {
    const r = await buffer<{ createPost: { __typename: string; post?: { id: string }; message?: string } }>(
      CREATE,
      {
        input: {
          channelId: CHANNEL,
          text,
          mode: "customScheduled",
          dueAt,
          schedulingType: "automatic",
          assets: [],
        },
      },
    );
    if (!r.data.createPost.post) throw new Error(`createPost: ${r.data.createPost.message}`);
    created.push(r.data.createPost.post.id);
    note(`- Created a scheduled post due ${dueAt} (${r.ms} ms): "${text.slice(0, 60)}..."`);
  }
  const [idA, idB] = created as [string, string];

  // Sign in to the running Still True with the personal key, then check the queue.
  const connect = await fetch(`${APP}/dev/connect`, { redirect: "manual" });
  const cookie = (connect.headers.get("set-cookie") ?? "").split(";")[0] as string;
  const headers = { cookie, "sec-fetch-site": "same-origin", "content-type": "application/json" };
  const t0 = performance.now();
  const board = (await (await fetch(`${APP}/api/me/check`, { method: "POST", headers })).json()) as {
    posts: { id: string; status: string; verdict: string; findings: { code: string }[] }[];
    budget: { requestsToday: number };
  };
  const checkMs = Math.round(performance.now() - t0);
  const a = board.posts.find((p) => p.id === idA);
  const b = board.posts.find((p) => p.id === idB);
  note(
    `- Still True checked the queue in ${checkMs} ms (${board.budget.requestsToday} Buffer requests today on this account).`,
  );
  note(
    `- Post A: verdict ${a?.verdict}, status ${a?.status}, findings ${a?.findings.map((f) => f.code).join(", ")}.`,
  );
  note(
    `- Post B: verdict ${b?.verdict}, status ${b?.status}, findings ${b?.findings.map((f) => f.code).join(", ")}.`,
  );

  // Read Buffer back directly.
  const postA = await buffer<{ post: { status: string; tags: { name: string }[] } }>(POST, { id: idA });
  record("post-held", postA.data);
  note(
    `- Buffer says post A is now "${postA.data.post.status}" with tags: ${postA.data.post.tags.map((t) => t.name).join(", ") || "none"}.`,
  );
  try {
    const notes = await buffer<{ collaborationNotes: { edges: { node: { text: string } }[] } }>(NOTES, {
      postId: idA,
    });
    record("notes", notes.data);
    const first = notes.data.collaborationNotes.edges[0]?.node.text ?? "(none)";
    note(`- Buffer note on post A: "${first.split("\n").slice(0, 2).join(" / ")}"`);
  } catch (error) {
    note(`- Notes could not be read with this key: ${(error as Error).message}`);
  }
  const queue = await buffer(QUEUE, {
    organizationId,
    status: ["scheduled", "draft"],
    start: new Date(now).toISOString(),
    end: new Date(now + 7 * 86_400_000).toISOString(),
    after: null,
  });
  record("queue", queue.data);

  // Release A, fix B, read both back.
  const release = (await (
    await fetch(`${APP}/api/me/posts/${idA}/release`, { method: "POST", headers })
  ).json()) as { ok: boolean; message: string };
  const releasedA = await buffer<{ post: { status: string; dueAt: string; tags: { name: string }[] } }>(
    POST,
    { id: idA },
  );
  record("post-released", releasedA.data);
  note(
    `- Release: ${release.message}. Buffer says "${releasedA.data.post.status}", due ${releasedA.data.post.dueAt}, tags: ${releasedA.data.post.tags.map((t) => t.name).join(", ") || "none"}.`,
  );
  const fix = (await (
    await fetch(`${APP}/api/me/posts/${idB}/fix`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code: "weekday_date_mismatch" }),
    })
  ).json()) as { ok: boolean; message: string };
  const fixedB = await buffer<{ post: { text: string; status: string } }>(POST, { id: idB });
  note(
    `- Fix on post B: ${fix.message}. Buffer now has: "${fixedB.data.post.text}" (${fixedB.data.post.status}).`,
  );
} finally {
  for (const id of created) {
    const r = await buffer<{ deletePost: { __typename: string } }>(DELETE, { id });
    note(`- Deleted test post: ${r.data.deletePost.__typename}.`);
  }
}

writeFileSync(
  resolve(root, "docs/LIVE.md"),
  `# Live check against the Buffer API\n\nRun with [\`scripts/live_check.ts\`](../scripts/live_check.ts) on a Mastodon channel of the author's own Buffer account. Every step below is a real call to \`api.buffer.com\`; the two test posts were deleted at the end and never published. Buffer's responses are kept, with ids replaced, in [\`test/fixtures/buffer\`](../test/fixtures/buffer).\n\n${log.slice(1).join("\n")}\n`,
);
console.log("docs/LIVE.md written");
