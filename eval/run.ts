// Scores the decision core against the labelled cases.
//   npm run eval            -> dev split, writes eval/results/dev.json
//   npm run eval -- heldout -> held-out split (scored once, at the end)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { checkPost } from "../src/core/check";
import { remembranceDays } from "../src/core/remembrance";
import type {
  CheckContext,
  DisasterEvent,
  FindingCode,
  PageFacts,
  PostUnderCheck,
  Verdict,
} from "../src/core/types";

interface Case {
  id: string;
  post: PostUnderCheck & { firstSeenDueAt?: string | null };
  context: {
    country: string;
    pages?: Record<string, PageFacts>;
    weather?: CheckContext["weather"];
    gdacs?: {
      type: DisasterEvent["type"];
      alert: DisasterEvent["alert"];
      country: string;
      iso3?: string;
      name: string;
      from: string;
      to?: string;
    }[];
    news?: CheckContext["news"];
  };
  expect: { verdict: Verdict; codes: FindingCode[] };
  why?: string;
}

export function loadCases(split: string): Case[] {
  return readFileSync(new URL(`./cases/${split}.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case);
}

export function toContext(c: Case): CheckContext {
  return {
    country: c.context.country,
    pages: c.context.pages ?? {},
    weather: c.context.weather ?? null,
    gdacs: (c.context.gdacs ?? []).map((g) => ({
      type: g.type,
      alert: g.alert,
      countries: [g.country],
      name: g.name,
      from: g.from,
      to: g.to ?? null,
    })),
    news: c.context.news ?? [],
    remembrance: remembranceDays(),
  };
}

export interface CodeScore {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export interface EvalReport {
  split: string;
  cases: number;
  healthy: number;
  verdictAccuracy: number;
  exactCodeMatch: number;
  falseHolds: number;
  falseFlagsOnHealthy: number;
  missedHolds: number;
  codes: Record<string, CodeScore>;
  errors: {
    id: string;
    expected: string[];
    got: string[];
    verdict: string;
    expectedVerdict: string;
    why?: string;
  }[];
}

export function evaluate(split: string): EvalReport {
  const cases = loadCases(split);
  const codes: Record<string, CodeScore> = {};
  const bump = (code: string, key: "tp" | "fp" | "fn") => {
    codes[code] ??= { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 };
    codes[code][key] += 1;
  };
  let verdictOk = 0;
  let exact = 0;
  let falseHolds = 0;
  let falseFlagsOnHealthy = 0;
  let missedHolds = 0;
  const errors: EvalReport["errors"] = [];
  for (const c of cases) {
    const result = checkPost({ ...c.post, firstSeenDueAt: c.post.firstSeenDueAt ?? null }, toContext(c));
    const got = [...new Set(result.findings.map((f) => f.code))].sort();
    const expected = [...new Set(c.expect.codes)].sort();
    for (const code of got) bump(code, expected.includes(code) ? "tp" : "fp");
    for (const code of expected) if (!got.includes(code)) bump(code, "fn");
    if (result.verdict === c.expect.verdict) verdictOk += 1;
    if (result.verdict === "hold" && c.expect.verdict !== "hold") falseHolds += 1;
    if (c.expect.verdict === "hold" && result.verdict !== "hold") missedHolds += 1;
    if (c.expect.verdict === "still_true" && result.verdict !== "still_true") falseFlagsOnHealthy += 1;
    if (JSON.stringify(got) === JSON.stringify(expected)) exact += 1;
    else
      errors.push({
        id: c.id,
        expected,
        got,
        verdict: result.verdict,
        expectedVerdict: c.expect.verdict,
        why: c.why,
      });
  }
  for (const score of Object.values(codes)) {
    score.precision = score.tp + score.fp === 0 ? 1 : score.tp / (score.tp + score.fp);
    score.recall = score.tp + score.fn === 0 ? 1 : score.tp / (score.tp + score.fn);
  }
  return {
    split,
    cases: cases.length,
    healthy: cases.filter((c) => c.expect.verdict === "still_true").length,
    verdictAccuracy: verdictOk / cases.length,
    exactCodeMatch: exact / cases.length,
    falseHolds,
    falseFlagsOnHealthy,
    missedHolds,
    codes: Object.fromEntries(Object.entries(codes).sort(([a], [b]) => a.localeCompare(b))),
    errors,
  };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/run.ts");
if (isMain) {
  const split = process.argv[2] ?? "dev";
  const report = evaluate(split);
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./results/${split}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
  console.log(`${split}: ${report.cases} cases (${report.healthy} healthy)`);
  console.log(
    `verdict accuracy ${pct(report.verdictAccuracy)} · exact codes ${pct(report.exactCodeMatch)} · false holds ${report.falseHolds} · flags on healthy ${report.falseFlagsOnHealthy} · missed holds ${report.missedHolds}`,
  );
  for (const [code, s] of Object.entries(report.codes)) {
    console.log(
      `${code.padEnd(28)} tp ${String(s.tp).padStart(3)} fp ${String(s.fp).padStart(3)} fn ${String(s.fn).padStart(3)}  P ${pct(s.precision)}  R ${pct(s.recall)}`,
    );
  }
  if (process.argv.includes("--errors")) {
    for (const e of report.errors)
      console.log(`  ${e.id}: expected [${e.expected}] got [${e.got}] (${e.why ?? ""})`);
  }
}
