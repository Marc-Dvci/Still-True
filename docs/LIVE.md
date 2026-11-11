# Live check against the Buffer API

## Through the live app and OAuth (11 Nov 2026)

On https://still-true.chatisthisreal.workers.dev, with Still True's Buffer App Client, on the author's own Buffer
account and Mastodon channel:

- A post linking the demo shop's out-of-stock shirt was scheduled in Buffer for Saturday 14 November, 10:00 Paris.
- "Connect Buffer" led to Buffer's consent screen (Still True asks for Your Account, Your Notes and Your Posts),
  then back to the board with a session. Tokens are kept encrypted in the account's Durable Object.
- The first check ran a moment after connecting and used 7 Buffer requests. Buffer then reported the post as
  `draft`, due at its original time, with the tag "Still True: held" (16:41:49 UTC), and this note on it
  (16:41:49 UTC): "Still True moved this post to drafts before it went out. • Product is out of stock: The page
  says "Linen shirt, natural" is out of stock. Review, fix or release it:
  https://still-true.chatisthisreal.workers.dev/board#post-…". The link opens that post on the board.
- "Release as written" on the live board: Buffer reported the post `scheduled` again for
  2026-11-14T09:00:00.000Z, with no tag. The post was then deleted; nothing was published.
- Buffer's own screens of the held post are in [`screens/buffer-held-and-noted.png`](screens/buffer-held-and-noted.png).

## With the local Worker and a personal key

Run with [`scripts/live_check.ts`](../scripts/live_check.ts) on a Mastodon channel of the author's own Buffer account. Every step below is a real call to `api.buffer.com`; the two test posts were deleted at the end and never published. Buffer's responses are kept, with ids replaced, in [`test/fixtures/buffer`](../test/fixtures/buffer).

- Created a scheduled post due 2026-11-15T09:00:00.000Z (355 ms): "Back in stock: our natural linen shirt, €49 https://still-tr..."
- Created a scheduled post due 2026-11-15T10:30:00.000Z (288 ms): "Open studio on Sunday 16 November: meet the makers, free ent..."
- Still True checked the queue in 1356 ms (46 Buffer requests today on this account).
- Post A: verdict hold, status held, findings out_of_stock.
- Post B: verdict review, status scheduled, findings weekday_date_mismatch.
- Buffer says post A is now "draft" with tags: Still True: held.
- Buffer note on post A: "Still True moved this post to drafts before it went out. / • Product is out of stock: The page says "Linen shirt, natural" is out of stock."
- Release: Scheduled again for 2026-11-15T09:00:00.000Z. Buffer says "scheduled", due 2026-11-15T09:00:00.000Z, tags: none.
- Fix on post B: Change "Sunday" to "Monday". Buffer now has: "Open studio on Monday 16 November: meet the makers, free entry." (scheduled).
- Deleted test post: DeletePostSuccess.
- Deleted test post: DeletePostSuccess.
