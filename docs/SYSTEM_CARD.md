# System card

## What it is for

Still True checks scheduled social media posts against facts that can change between scheduling and
publishing, and holds or flags the posts those facts contradict. It is for the people who post every
day: small businesses, creators, venues and agencies using Buffer.

It is built to catch contradictions a careful editor would catch: dates, prices, stock, event status,
weather, remembrance days, and wording that echoes an active disaster in the audience's country. It does
not judge the quality, tone or politics of a post beyond those rules, and it does not decide whether a
post may ever be published: a person always can.

## How decisions are made

- **Every verdict comes from deterministic code** ([`src/core`](../src/core)): pure functions over the
  post and the facts read about the world. The same inputs always give the same verdict.
- Each finding carries its evidence: the words in the post, the value read from the source, the source's
  address and the time it was read.
- **Holds are reversible.** A hold moves the post to drafts in Buffer, keeps its original time, and is
  released by one action. Nothing is deleted. A setting turns holds off entirely.
- **A model is used in one place**: Workers AI drafts new wording when a person presses "Suggest
  wording". The draft is shown, never applied on its own, and refused if it adds a number, date, weekday,
  link, handle or hashtag that the post did not contain ([`src/ai/assist.ts`](../src/ai/assist.ts)). No
  model is called during a check.

## Data

- From Buffer: account id, name and timezone; organisations; channels; scheduled posts and timed drafts
  for the next seven days.
- From the world: the pages linked in posts, Open-Meteo forecasts for the business location the owner
  sets, GDACS disaster alerts, Wikipedia's Current Events, and a calendar of 31 remembrance days in 17
  countries with a source for each ([`data/remembrance.json`](../data/remembrance.json)).
- Stored per account in its own Durable Object: encrypted tokens, settings, the posts in the next seven
  days with their findings, recent page facts, and a hash-chained log of actions taken in Buffer. Removed
  when a post leaves the queue; everything is deleted on disconnect.

## Evaluation

410 labelled cases, written and committed before the detectors, with 191 healthy posts: every verdict
matches the rules and no healthy post is held or flagged ([`EVALUATION.md`](EVALUATION.md)). Parsers are
tested on real page markup and recorded GDACS, Wikipedia and Open-Meteo responses. Five real days are
replayed in the fire drill.

## Known boundaries

- GDACS covers natural hazards; human-caused events come from Wikipedia's Current Events, which is
  edited by volunteers through the day. Both raise a review or a hold for a person, never anything more.
- The weather check needs a business location; without one it stays off.
- Dates and relative days are read in English and French.

## Oversight and corrections

The owner sees every finding with its evidence, on the board and in the note inside Buffer, and can
release, fix or dismiss it. Dismissed findings stay dismissed for that post. Corrections to the rules or
the remembrance calendar: [open an issue](https://github.com/Marc-Dvci/Still-True/issues).
