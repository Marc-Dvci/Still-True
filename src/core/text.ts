// Text helpers shared by the detectors. `fold` lowercases and strips accents one UTF-16 code unit at a
// time, so the folded string has the same length as the original and match positions can highlight
// the original text.

export function fold(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    const code = ch.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) {
      out += ch; // surrogate halves (emoji) pass through unchanged
      continue;
    }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += base.length === 1 ? base : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
  }
  return out;
}

export interface Match {
  text: string;
  start: number;
  end: number;
}

/** All matches of `pattern` (built on folded words) in the folded text, as spans of the original. */
export function findAll(original: string, pattern: RegExp): Match[] {
  const folded = fold(original);
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const matches: Match[] = [];
  for (const m of folded.matchAll(re)) {
    const start = m.index ?? 0;
    matches.push({ text: original.slice(start, start + m[0].length), start, end: start + m[0].length });
  }
  return matches;
}

/** Replaces every URL with spaces of the same length, so dates, weekdays, times and prices inside links
 * ("sunday-hall.example", "/2026/11/14") are never read as part of the message. */
export function maskUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi, (m) => " ".repeat(m.length));
}

export function has(original: string, pattern: RegExp): boolean {
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).test(fold(original));
}

/** Sentences (or lines), with their offsets in the original text. */
export function sentences(text: string): Match[] {
  const out: Match[] = [];
  const re = /[^.!?\n]+[.!?]*|\n/g;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (m[0].trim()) out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out.length ? out : [{ text, start: 0, end: text.length }];
}

// ---------------------------------------------------------------------------------------- tone lexicons
// Patterns run on folded text: lowercase, no accents.

export const PROMOTIONAL =
  /\b(sales?\b(?! team| rep| manager| department)|on sale|\d+\s?%\s?off|% off|discount|deals?|promo(?:tion)?s?|promo code|coupon|code\s+[a-z0-9]{3,}|buy now|shop now|order now|flash sale|vente flash|giveaway|win an?\b|free shipping|limited time|half price|2 for 1|two for one|bogo|black friday|cyber monday|clearance|special offer|soldes|reduction|remise|offre speciale|bon plan|jeu concours|gagnez|a gagner|code promo|livraison offerte|destockage|rebajas|oferta|descuento|rabatt|angebot)\b|-\s?\d+\s?%|\b\d+\s?%\s?(?:de reduction|de remise|off|discount)/;

export const PLAYFUL = /(\u{1F389}|\u{1F973}|\u{1F602}|\u{1F923}|\u{1F38A}|\u{1F37E}|\u{1F61C}|\u{1F60E}|\u{1F483}|\u{1F57A})|\b(party|partying|let'?s celebrate|celebrat(?:e|ion|ing)|woo+hoo+|yay+|lol|fiesta|c'?est la fete|on fait la fete|faire la fete|soiree dansante|happy hour)\b/u;

export const SUPPORTIVE =
  /\b(thoughts are with|our thoughts|our hearts|hearts go out|thinking of|praying|prayers|stay safe|be safe|donat(?:e|ion|ions|ing)|relief fund|relief effort|for (?:the )?(?:flood|fire|storm|earthquake|hurricane) relief|fundrais\w*|solidarity|condolences|in memory|we remember|lest we forget|minute of silence|moment of silence|we will be closed|we are closed|closed today|pensees|soutien|solidarite|nos dons|faire un don|collecte|condoleances|hommage|en memoire|minute de silence|nous serons fermes|ferme aujourd'?hui|recueillement)\b/;

export function isPromotional(text: string): boolean {
  return has(text, PROMOTIONAL);
}

export function isPlayful(text: string): boolean {
  return PLAYFUL.test(text) || has(text, PLAYFUL);
}

export function isSupportive(text: string): boolean {
  return has(text, SUPPORTIVE);
}

export function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Keeps the case style of `like` (Title, UPPER or lower) when substituting `word`. */
export function matchCase(word: string, like: string): string {
  if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase();
  if (like.charAt(0) === like.charAt(0).toUpperCase()) return capitalise(word);
  return word.toLowerCase();
}
