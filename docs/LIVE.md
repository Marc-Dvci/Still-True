# Live check against the Buffer API

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
