export interface TextPart {
  text: string;
  match: boolean;
}

/** Words that carry no meaning on their own; highlighting them is noise ("he" in "held"). */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'it', 'at', 'for', 'by', 'with', 'from', 'as',
  'be', 'was', 'were', 'are', 'am', 'been', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can',
  'could', 'should', 'i', 'he', 'she', 'we', 'they', 'you', 'me', 'him', 'her', 'us', 'them', 'my', 'his',
  'our', 'their', 'your', 'this', 'that', 'these', 'those', 'what', 'when', 'where', 'who', 'why', 'how',
  'which', 'about', 'so', 'if', 'then', 'than', 'there', 'here', 'not', 'no', 'any', 'all', 'some', 'say',
  'said', 'talk', 'talked', 'think', 'thinks',
]);

/** Below this length a term must match a whole word; longer terms also match as a prefix ("budget" → "budgets"). */
const MIN_PREFIX_LENGTH = 4;

/** Words from the query worth highlighting: lowercased, punctuation stripped, no stop words. */
export function queryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    // Strip sentence punctuation only, so terms like "c++" or "c#" survive.
    .map((w) => w.replace(/^[.,!?;:"'()[\]{}“”‘’]+|[.,!?;:"'()[\]{}“”‘’]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/**
 * Splits text into plain and matching parts so the template can wrap matches in <mark>
 * without using innerHTML. Matching is case-insensitive and starts at a word boundary; terms of
 * MIN_PREFIX_LENGTH or more also match as prefixes, shorter ones only as whole words.
 */
export function splitHighlight(text: string, query: string): TextPart[] {
  const terms = queryTerms(query);
  if (!text || terms.length === 0) {
    return text ? [{ text, match: false }] : [];
  }
  const escaped = terms
    .sort((a, b) => b.length - a.length)
    .map((t) => {
      const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return t.length >= MIN_PREFIX_LENGTH ? e : `${e}(?![\\p{L}\\p{N}])`;
    });
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})`, 'giu');

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
