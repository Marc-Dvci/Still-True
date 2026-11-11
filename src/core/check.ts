// The decision core's entry point: one post, the facts about the world, and a verdict with evidence.
import { calendarFindings } from "./detectors/calendar";
import { pageFindings } from "./detectors/page";
import { weatherFindings } from "./detectors/weather";
import { remembranceFindings, worldFindings } from "./detectors/world";
import {
  VERDICT_RANK,
  type CheckContext,
  type CheckResult,
  type Finding,
  type PostUnderCheck,
  type Verdict,
} from "./types";

export const DETECTORS = [
  calendarFindings,
  pageFindings,
  weatherFindings,
  remembranceFindings,
  worldFindings,
] as const;

export function verdictOf(findings: Finding[]): Verdict {
  return findings.reduce<Verdict>(
    (worst, f) => (VERDICT_RANK[f.verdict] > VERDICT_RANK[worst] ? f.verdict : worst),
    "still_true",
  );
}

export function checkPost(post: PostUnderCheck, ctx: CheckContext): CheckResult {
  const findings = DETECTORS.flatMap((detector) => detector(post, ctx));
  return { verdict: verdictOf(findings), findings };
}
