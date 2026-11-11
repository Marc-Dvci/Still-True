// A stand-in for api.buffer.com and auth.buffer.com, answering each GraphQL operation by name with the
// shapes of Buffer's schema. Every request is recorded so tests can assert what was sent.
export interface Call {
  operation: string;
  variables: Record<string, unknown>;
}

export interface FakeBuffer {
  calls: Call[];
  tokenRequests: URLSearchParams[];
  posts: Record<string, unknown>[];
  /** Channels connected in the organisation; change it to simulate connecting one in Buffer. */
  channelCount: number;
  fetch: typeof fetch;
}

const ORIGIN = "https://still-true.test";

export function bufferPost(id: string, text: string, dueAt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    text,
    status: "scheduled",
    dueAt,
    createdAt: "2026-11-09T09:00:00.000Z",
    updatedAt: "2026-11-09T09:00:00.000Z",
    channelId: "ch1",
    channelService: "bluesky",
    via: "buffer",
    isCustomScheduled: true,
    shareMode: "customScheduled",
    schedulingType: "automatic",
    author: { name: "Owner", urn: "urn:buffer:account:acc1" },
    tags: [],
    metadata: { __typename: "BlueskyPostMetadata", linkAttachment: null },
    ...extra,
  };
}

export function fakeBuffer(
  posts: Record<string, unknown>[],
  options: { world?: "down"; holdFails?: boolean } = {},
): FakeBuffer {
  const calls: Call[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const fake: FakeBuffer = {
    calls,
    tokenRequests,
    posts,
    channelCount: 1,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://auth.buffer.com/")) {
        const body = new URLSearchParams(String(init?.body ?? ""));
        tokenRequests.push(body);
        if (url.endsWith("/token/revocation")) return new Response(null, { status: 200 });
        return Response.json({
          access_token: `access-${tokenRequests.length}`,
          refresh_token: `refresh-${tokenRequests.length}`,
          expires_in: 3600,
          scope: "posts:read posts:write notes:write offline_access",
        });
      }
      if (url === "https://api.buffer.com") {
        const { query, variables } = JSON.parse(String(init?.body)) as {
          query: string;
          variables: Record<string, unknown>;
        };
        const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown";
        calls.push({ operation, variables });
        // Recorded from api.buffer.com (11 Nov 2026): a post that does not exist is a GraphQL error.
        if (operation === "Post" && !fake.posts.some((p) => p.id === variables.id)) {
          return Response.json({
            errors: [
              {
                message: `Post not found for id: ${String(variables.id)}`,
                path: ["post"],
                extensions: { code: "NOT_FOUND" },
              },
            ],
            data: null,
          });
        }
        const data = answer(operation, variables, fake, options);
        return Response.json(
          { data },
          // Buffer's own form (recorded 11 Nov 2026): one member per window.
          {
            headers: {
              RateLimit: '"15m"; r=90; t=600, "24h"; r=500; t=80000, "30d"; r=900; t=2500000',
              "RateLimit-Policy": '"15m"; q=150; w=900, "24h"; q=600; w=86400, "30d"; q=1000; w=2592000',
            },
          },
        );
      }
      if (url.startsWith("https://www.gdacs.org/") || url.startsWith("https://en.wikipedia.org/")) {
        if (options.world === "down") return new Response("unavailable", { status: 503 });
        if (url.includes("gdacs")) return Response.json({ type: "FeatureCollection", features: [] });
        return Response.json({ parse: { wikitext: "" } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
  };
  return fake;
}

const EDITS = new Set(["Hold", "Release", "EditText", "Reschedule", "SetTags"]);

function answer(
  operation: string,
  variables: Record<string, unknown>,
  fake: FakeBuffer,
  options: { holdFails?: boolean },
): unknown {
  // Recorded from api.buffer.com (11 Nov 2026): an editPost without text is refused.
  if (EDITS.has(operation) && (typeof variables.text !== "string" || variables.text === "")) {
    return {
      editPost: {
        __typename: "InvalidInputError",
        message: "Invalid post: Post must have either text or media.",
      },
    };
  }
  if (operation === "Hold" && options.holdFails) {
    return { editPost: { __typename: "UnexpectedError", message: "Buffer could not save the draft" } };
  }
  const success = (id: string, status: string) => ({
    __typename: "PostActionSuccess",
    post: { id, status, dueAt: variables.dueAt ?? null, text: "" },
  });
  switch (operation) {
    case "Account":
      return {
        account: {
          id: "acc1",
          name: "Test shop",
          timezone: "Europe/Paris",
          organizations: [
            { id: "org1", name: "Shop", channelCount: fake.channelCount, limits: { scheduledPosts: 10 } },
          ],
        },
      };
    case "Channels":
      return {
        channels: Array.from({ length: fake.channelCount }, (_, i) => ({
          id: `ch${i + 1}`,
          name: i === 0 ? "shop.bsky.social" : `channel-${i + 1}`,
          displayName: i === 0 ? "Shop" : `Channel ${i + 1}`,
          service: "bluesky",
          avatar: "",
          timezone: "Europe/Paris",
          isDisconnected: false,
          isQueuePaused: false,
          isLocked: false,
        })),
      };
    case "Queue":
      return {
        posts: {
          edges: fake.posts.map((node) => ({ node })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    case "Post":
      return { post: fake.posts.find((p) => p.id === variables.id) };
    case "Tags":
      return { tagsV2: { edges: [] } };
    case "CreateTag":
      return {
        createTag: {
          __typename: "TagActionSuccess",
          tag: {
            id: `tag-${String(variables.name).includes("held") ? "held" : "review"}`,
            name: variables.name,
            color: variables.color,
          },
        },
      };
    case "Hold":
      return { editPost: success(String(variables.id), "draft") };
    case "Release":
    case "EditText":
    case "Reschedule":
    case "SetTags":
      return { editPost: success(String(variables.id), "scheduled") };
    case "AddNote":
      return {
        createCollaborationNote: {
          __typename: "CreateCollaborationNoteSuccess",
          edge: { node: { id: "note1" } },
        },
      };
    case "CreateDraft":
      return { createPost: success("draft-1", "draft") };
    default:
      return {};
  }
}

export const demo = (path: string) => `${ORIGIN}${path}`;
