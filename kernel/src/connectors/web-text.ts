export function focusedText(
  text: string,
  focus: string,
  maxCharacters: number,
): string {
  if (text.length <= maxCharacters) return text;
  const terms = [...new Set(focus.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [])]
    .filter((term) => !webResearchStopWords.has(term))
    .slice(0, 24);
  if (terms.length === 0)
    return `${text.slice(0, maxCharacters)}\n\n[Page excerpt truncated by Springroll]`;

  const blocks = text
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => ({
      block,
      index,
      score: terms.reduce(
        (total, term) => total + (block.toLowerCase().split(term).length - 1),
        0,
      ),
    }));
  const selected = blocks
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 12)
    .sort((left, right) => left.index - right.index);
  if (selected.length === 0) {
    return `${text.slice(0, maxCharacters)}\n\n[No focused section was found; page excerpt truncated by Springroll]`;
  }

  let result = "";
  for (const { block } of selected) {
    const addition = result ? `\n\n${block}` : block;
    if (result.length + addition.length > maxCharacters) {
      const remaining = maxCharacters - result.length;
      if (remaining > 80) result += addition.slice(0, remaining);
      break;
    }
    result += addition;
  }
  return `${result}\n\n[Focused excerpts selected by Springroll]`;
}

const webResearchStopWords = new Set([
  "about",
  "after",
  "from",
  "into",
  "only",
  "page",
  "public",
  "read",
  "source",
  "that",
  "their",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
]);
