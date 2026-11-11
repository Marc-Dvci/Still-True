# How Still True uses the Buffer API

Endpoint `https://api.buffer.com` (GraphQL). Authorization `https://auth.buffer.com` (OAuth 2.0).

## Authentication

- **Authorization Code with PKCE (S256)**, `prompt=consent`, scopes `account:read posts:read posts:write
  notes:read notes:write offline_access` ([`src/buffer/oauth.ts`](../src/buffer/oauth.ts)). The scopes can be
  narrowed with `BUFFER_SCOPES`; without the notes scopes, explanations are written as tags only.
- The OAuth `state` and PKCE verifier travel in a cookie encrypted with AES-GCM and expire after ten
  minutes; the verifier never reaches the browser in clear.
- The confidential client secret is sent in the form body (`client_secret_post`), as Buffer's
  authorization server advertises.
- **Rotating refresh tokens.** Buffer replaces the refresh token on every refresh and revokes the grant
  if an old one is reused. Each account has exactly one owner of its tokens, its Durable Object, whose
  input gates serialise the read, refresh and write. Tokens are stored encrypted with AES-GCM, bound to
  the Buffer account id as associated data.
- Disconnect calls `https://auth.buffer.com/token/revocation`, then deletes all stored data.

## Operations

All 13 are in [`src/buffer/operations.ts`](../src/buffer/operations.ts) and validated against
[`schema/buffer.graphql`](../schema/buffer.graphql) (introspected from `api.buffer.com`, 6,335 lines) by
[`test/unit/operations.test.ts`](../test/unit/operations.test.ts).

| Operation | GraphQL | When |
|---|---|---|
| `Account` | `account { organizations }` | Each check, and at sign-in |
| `Channels` | `channels(input: { organizationId })` | Cached for an hour |
| `Queue` | `posts(input: { filter: { status: [scheduled, draft], dueAt: { start, end } }, sort: dueAt })`, 100 per page | Each check |
| `Post` | `post(input: { id })` | Before a release, to keep the post's other tags |
| `Hold` | `editPost(input: { id, saveToDraft: true, tagIds })` | A certain problem, in "hold" mode |
| `Release` | `editPost(input: { id, saveToDraft: false, mode: customScheduled, dueAt, tagIds })` | The owner presses Release |
| `EditText` | `editPost(input: { id, text })` | The owner applies a text fix |
| `Reschedule` | `editPost(input: { id, mode: customScheduled, dueAt })` | The owner moves a post to the next dry slot |
| `SetTags` | `editPost(input: { id, tagIds })` | A post goes to review |
| `AddNote` | `createCollaborationNote(input: { subject: { postId }, text })` | A new finding on a post |
| `Tags` / `CreateTag` | `tagsV2`, `createTag` | Once per organisation, for the two Still True tags |
| `CreateDraft` | `createPost(input: { ..., saveToDraft: true })` | The owner asks for sample drafts |

Buffer refuses an `editPost` that does not carry `text` ("Invalid post: Post must have either text or
media"), so every edit sends the post's current text, read in the same check. The live check
([`LIVE.md`](LIVE.md)) found this; the test stand-in now refuses the same call, and a test pins it.

Every mutation selects `... on MutationError { message }`, so a typed refusal (not found, limit reached,
invalid input) is recorded in the account's action log instead of being lost.

## Errors and limits

[`src/buffer/client.ts`](../src/buffer/client.ts) turns Buffer's failure shapes into typed errors:

- HTTP 401, or `UNAUTHENTICATED` / `UNAUTHORIZED` in the body: the account must reconnect; checks stop.
- HTTP 429 or `RATE_LIMIT_EXCEEDED`: the next check is scheduled after Buffer's `Retry-After`.
- Any other GraphQL error: retried at the next check, five minutes later.
- The `RateLimit` header is read on every response. Buffer sends one member per window (`"15m"; r=87; t=650, "24h"; r=262; ...`); Still True keeps the window with the fewest requests left.

## Request budget

App Clients get 100 requests per 15 minutes and 500 per day, plus 10 and 25 per authorised user. Still
True is built to stay far inside that:

- One check costs one `Account` and one `Queue` request per organisation. `Channels` is cached for an hour,
  or until the organisation's channel count changes, and the tags are looked up once.
- Checks on one account run one at a time, so the first check after connecting and a check asked for
  meanwhile never write the same hold or note twice.
- Checks run on each account's own Durable Object alarm: a sweep every three hours (every thirty minutes
  when a post is due within three hours), and a re-check 60 and 10 minutes before each post. A queue of
  ten posts a day costs about 40 to 60 requests a day.
- Writes happen only when something changes, and each finding is held and noted once.
- Disaster alerts and news are read once for all accounts every thirty minutes by a shared Durable Object.

## No webhooks

Buffer's API has no webhooks, so Still True polls, on a schedule driven by the queue itself (the next
due times) rather than a fixed interval.
