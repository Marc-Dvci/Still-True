// The only place a model is used: on request, it drafts new wording for a flagged post. It never decides
// a verdict. A suggestion is rejected if it adds a number, date, link, handle or hashtag that the
// original post does not contain, so the model cannot introduce a new claim.
import type { Finding } from "../core/types";

/** The slice of the Workers AI binding this module uses. */
export interface TextModel {
  run(model: string, input: unknown): Promise<unknown>;
}

export const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fast",
] as const;

const SYSTEM = [
  "You rewrite one social media post so that a stated problem no longer applies.",
  "Keep the author's language, voice, emoji style and links.",
  "Never add a number, price, date, time, weekday, link, @handle or #hashtag that is not already in the post.",
  "If the problem cannot be fixed by rewording, shorten the post to what is still true.",
  "Answer with the rewritten post only, no quotes and no commentary.",
].join(" ");

const TOKENS = /https?:\/\/\S+|[@#][\p{L}\p{N}_]+|\d+(?:[.,:]\d+)*/gu;
const WEEKDAYS =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/giu;

/** Tokens a suggestion may use: those already in the post, plus those the deterministic fix proposes. */
export function introducedClaims(original: string, suggestion: string, allowed: string[] = []): string[] {
  const known = new Set(
    [
      ...original.matchAll(TOKENS),
      ...original.matchAll(WEEKDAYS),
      ...allowed.flatMap((a) => [...a.matchAll(TOKENS), ...a.matchAll(WEEKDAYS)]),
    ].map((m) => m[0].toLowerCase()),
  );
  const added = [...suggestion.matchAll(TOKENS), ...suggestion.matchAll(WEEKDAYS)]
    .map((m) => m[0].toLowerCase())
    .filter((token) => !known.has(token));
  return [...new Set(added)];
}

export function cleanSuggestion(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:here(?:'s| is) (?:the |a )?rewritten post:?\s*)/i, "")
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
}

export interface Suggestion {
  text: string | null;
  reason: string;
  model?: string;
}

export async function suggestRewrite(
  ai: TextModel | undefined,
  text: string,
  finding: Finding,
): Promise<Suggestion> {
  if (!ai) return { text: null, reason: "Suggestions are unavailable on this deployment." };
  const prompt = `Post:\n${text}\n\nProblem: ${finding.title}. ${finding.detail}`;
  for (const model of MODELS) {
    try {
      const result = (await ai.run(model, {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        max_tokens: 400,
        temperature: 0.3,
      })) as { response?: string };
      const candidate = cleanSuggestion(result.response ?? "");
      if (!candidate) continue;
      const added = introducedClaims(text, candidate, finding.fix?.text ? [finding.fix.text] : []);
      if (added.length > 0) {
        return {
          text: null,
          reason: `The suggestion added ${added.join(", ")}, which the post did not say.`,
          model,
        };
      }
      if (candidate.length > Math.max(text.length * 1.6, text.length + 120)) {
        return { text: null, reason: "The suggestion was much longer than the post.", model };
      }
      return { text: candidate, reason: "Suggested wording. Nothing changes until you apply it.", model };
    } catch (error) {
      console.warn(JSON.stringify({ event: "ai_failed", model, message: (error as Error).message }));
    }
  }
  return { text: null, reason: "No suggestion could be produced right now." };
}
