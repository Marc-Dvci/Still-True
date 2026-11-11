// The links a post carries: URLs in its text, plus the link fields some networks keep in metadata
// (Facebook, LinkedIn, Bluesky and Threads link attachments, Instagram's link sticker).

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'()]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'()]*/gi;
// Punctuation that ends a sentence rather than a URL. Trimmed with a loop from the end: a `[...]+$` regular
// expression takes quadratic time on a long run of these characters that is not at the end (CodeQL
// js/polynomial-redos).
const TRAILING = new Set([...".,;:!?…»”’)]"]);
export const MAX_LINKS = 5;

export function trimTrailingPunctuation(raw: string): string {
  let end = raw.length;
  while (end > 0 && TRAILING.has(raw[end - 1] as string)) end -= 1;
  return raw.slice(0, end);
}

export function normaliseUrl(raw: string): string | null {
  const trimmed = trimTrailingPunctuation(raw);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function linksInText(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)]
    .map((m) => normaliseUrl(m[0]))
    .filter((u): u is string => u !== null);
}

function metadataLinks(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const found: string[] = [];
  const record = metadata as Record<string, unknown>;
  if (typeof record.link === "string") found.push(record.link);
  const attachment = record.linkAttachment as { url?: unknown } | null | undefined;
  if (attachment && typeof attachment.url === "string") found.push(attachment.url);
  return found.map(normaliseUrl).filter((u): u is string => u !== null);
}

export function extractLinks(text: string, metadata: unknown): string[] {
  return [...new Set([...linksInText(text), ...metadataLinks(metadata)])].slice(0, MAX_LINKS);
}
