export interface TextPart {
  text: string;
  match: boolean;
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'it', 'at', 'for']);

/** Words from the query worth highlighting: lowercased, punctuation stripped, no stop words. */
export function queryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    // Strip sentence punctuation only, so terms like "c++" or "c#" survive.
    .map((w) => w.replace(/^[.,!?;:"'()[\]{}]+|[.,!?;:"'()[\]{}]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/**
 * Splits text into plain and matching parts so the template can wrap matches in <mark>
 * without using innerHTML. Matching is case-insensitive and also matches word prefixes
 * ("budget" highlights "budgets").
 */
export function splitHighlight(text: string, query: string): TextPart[] {
  const terms = queryTerms(query);
  if (!text || terms.length === 0) {
    return text ? [{ text, match: false }] : [];
  }
  const escaped = terms
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})`, 'giu');

  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) {
      parts.push({ text: text.slice(last, start), match: false });
    }
    parts.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), match: false });
  }
  return parts;
}
