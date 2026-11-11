# Evaluation

Still True's verdicts come from written rules. The evaluation measures whether the code applies those
rules: on posts that should be flagged, and above all on healthy posts that must pass.

## The cases

- **410 labelled cases** in [`eval/cases/`](../eval/cases): 267 for development and 143 held out.
- **Written and committed before the detectors.** The history shows the cases (`Add labelled evaluation
  cases`) landing before the decision core (`Decision core: ...`).
- **191 healthy posts** (124 + 67), many of them near misses that must not fire: a weekday that matches
  its date, "tomorrow" in a post written the same day, a price that matches one of several variants,
  "fire safety tips" with no disaster in the audience's country, a promotion during a disaster in another
  country, a supportive post during a disaster at home, "good morning" at 08:00.
- **Every one of the 18 finding codes** has at least 8 positive cases in development and 4 held out.
- **Two languages and eight countries**: about 70 % English and 30 % French; France, the United States,
  the United Kingdom, Canada, Germany, Spain and Australia, each with its own timezone.
- Each case gives the facts as the fetchers would return them (page status, price, stock, event date and
  status, the forecast at the due hour, GDACS alerts, news items). The parsers that produce those facts
  from real HTML and API responses are tested separately on recorded markup
  ([`test/unit/page.test.ts`](../test/unit/page.test.ts), [`test/unit/world.test.ts`](../test/unit/world.test.ts),
  [`test/unit/weather.test.ts`](../test/unit/weather.test.ts)).
- Each case carries a one-line reason (`why`). Every weekday named next to a date was computed, not
  written by hand.

## Results

| Set | Cases | Healthy | Verdicts right | Codes exactly right | Healthy posts held | Healthy posts flagged | Holds missed |
|---|---|---|---|---|---|---|---|
| Development | 267 | 124 | 267 | 267 | 0 | 0 | 0 |
| Held out | 143 | 67 | 143 | 143 | 0 | 0 | 0 |

Per code, development / held out (true positives; no false positive and no miss on either set):

| Code | Dev | Held out | Code | Dev | Held out |
|---|---|---|---|---|---|
| `weekday_date_mismatch` | 11 | 5 | `out_of_stock` | 8 | 5 |
| `relative_anchor_conflict` | 9 | 6 | `price_changed` | 9 | 4 |
| `due_moved_relative_word` | 8 | 5 | `event_cancelled` | 8 | 4 |
| `time_already_passed` | 8 | 4 | `event_postponed` | 8 | 4 |
| `date_already_passed` | 8 | 5 | `event_date_changed` | 8 | 5 |
| `daypart_mismatch` | 10 | 4 | `weather_contradiction` | 9 | 6 |
| `link_dead` | 9 | 4 | `remembrance_day_tone` | 11 | 6 |
| `link_redirect_home` | 9 | 4 | `disaster_wording_collision` | 8 | 5 |
| `major_news_window` | 9 | 4 | `disaster_promo_window` | 8 | 4 |

The full reports are [`eval/results/dev.json`](../eval/results/dev.json) and
[`eval/results/heldout.json`](../eval/results/heldout.json). The evaluation runs in CI as
[`test/unit/evaluation.test.ts`](../test/unit/evaluation.test.ts), so a change that lowers any of these
figures fails the build.

## Changes made after the first measurement

The first run on the development set gave 99.6 % of verdicts right (one hold missed, one extra finding).
Both were real gaps, fixed in the detectors, and the set itself was not changed:

| Change | Before | After |
|---|---|---|
| French inflections in hazard words ("prix brûlants" during a wildfire) | missed hold | held |
| Text inside links is never read as words ("sunday-hall.example" is not a Sunday) | extra finding | none |

The held-out set was scored once, after the decision core was frozen.

## Real days

The fire drill replays the same eight posts on five real days with the records published for them:
GDACS alerts, Wikipedia's Current Events and Open-Meteo's archived weather
([`data/drills.json`](../data/drills.json), built by [`scripts/build_drills.ts`](../scripts/build_drills.ts)
from [`test/fixtures`](../test/fixtures)). The expected outcome of every drill is pinned in
[`test/unit/drill.test.ts`](../test/unit/drill.test.ts).

## Reproduce

```sh
npm ci
npm run eval              # development set, writes eval/results/dev.json
npm run eval -- heldout   # held-out set
npx tsx eval/run.ts dev --errors   # lists every disagreement with its reason
```
