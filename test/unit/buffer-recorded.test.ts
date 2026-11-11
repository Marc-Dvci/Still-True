import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractLinks } from "../../src/core/links";

// Responses recorded from api.buffer.com by scripts/live_check.ts (ids replaced). They pin the shapes
// Still True reads to Buffer's real answers, not to the test stand-in.
const recorded = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/buffer/${name}.json`, import.meta.url), "utf8")) as Record<
    string,
    never
  >;

interface Node {
  id: string;
  text: string;
  status: string;
  dueAt: string;
  createdAt: string;
  channelId: string;
  channelService: string;
  tags: { id: string; name: string }[];
  metadata: { __typename: string } | null;
}

describe("recorded Buffer responses", () => {
  const queue = recorded("queue") as {
    posts: { edges: { node: Node }[]; pageInfo: { hasNextPage: boolean } };
  };

  it("carry every field the queue reader uses", () => {
    expect(queue.posts.edges.length).toBeGreaterThan(0);
    for (const { node } of queue.posts.edges) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.text).toBe("string");
      expect(["scheduled", "draft"]).toContain(node.status);
      expect(Number.isNaN(Date.parse(node.dueAt))).toBe(false);
      expect(Number.isNaN(Date.parse(node.createdAt))).toBe(false);
      expect(node.channelService).toBe("mastodon");
      expect(Array.isArray(node.tags)).toBe(true);
    }
    expect(typeof queue.posts.pageInfo.hasNextPage).toBe("boolean");
  });

  it("let the link reader find the demo shop link in a real post", () => {
    const post = queue.posts.edges.find((e) => e.node.text.includes("linen shirt"))?.node as Node;
    expect(extractLinks(post.text, post.metadata)).toEqual([
      "https://still-true.chatisthisreal.workers.dev/demo/shop/linen-shirt",
    ]);
  });

  it("show a held post as a draft with the held tag, and a released one scheduled without it", () => {
    const held = recorded("post-held") as { post: { status: string; tags: { name: string }[] } };
    expect(held.post.status).toBe("draft");
    expect(held.post.tags.map((t) => t.name)).toEqual(["Still True: held"]);
    const released = recorded("post-released") as { post: { status: string; tags: unknown[] } };
    expect(released.post.status).toBe("scheduled");
    expect(released.post.tags).toEqual([]);
  });

  it("show the note Still True wrote inside Buffer", () => {
    const notes = recorded("notes") as { collaborationNotes: { edges: { node: { text: string } }[] } };
    expect(notes.collaborationNotes.edges[0]?.node.text).toContain("moved this post to drafts");
  });
});
