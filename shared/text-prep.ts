const STRUCTURAL_LINE_RE =
  /^\s*(?:[-*\u2022]\s+|\d+[.)]\s+|#{1,6}\s+|(?:you must|ensure that|do not|always|never|important|note|warning|requirement)[:\s])/i;

interface TextRange {
  start: number;
  end: number;
}

export function structuredTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const lines = text.split('\n');
  const structuralRanges: TextRange[] = [];
  let offset = 0;

  for (const line of lines) {
    if (STRUCTURAL_LINE_RE.test(line)) {
      structuralRanges.push({ start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  }

  const structuralBudget = Math.floor(maxChars * 0.6);
  let structuralChars = 0;
  const keptStructural: TextRange[] = [];
  for (const range of structuralRanges) {
    const len = range.end - range.start;
    const joinCost = keptStructural.length > 0 ? 1 : 0;
    if (structuralChars + joinCost + len > structuralBudget) break;
    keptStructural.push(range);
    structuralChars += joinCost + len;
  }

  const newlineBudget = keptStructural.length + 1;
  const remaining = Math.max(0, maxChars - structuralChars - newlineBudget);
  const headBudget = Math.floor(remaining * 0.5);
  const tailBudget = remaining - headBudget;

  const headRange: TextRange = { start: 0, end: Math.min(headBudget, text.length) };
  const tailRange: TextRange = {
    start: Math.max(0, text.length - tailBudget),
    end: text.length,
  };

  const allRanges = [...keptStructural, headRange, tailRange].sort((a, b) => a.start - b.start);

  const merged: TextRange[] = [];
  for (const range of allRanges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }

  const assembled = merged.map((range) => text.slice(range.start, range.end)).join('\n');
  return assembled.length > maxChars ? assembled.slice(0, maxChars) : assembled;
}

export function stripInlineMarkdown(text: string): string {
  let out = text;

  out = out.replace(/`{1,3}([^`]+?)`{1,3}/g, '$1');

  for (let i = 0; i < 3; i++) {
    const prev = out;
    out = out.replace(/(\*\*|__)([^\n]+?)\1/g, '$2');
    out = out.replace(
      /(\*|_)([^\n]+?)\1/g,
      (match, marker: string, inner: string, offset: number, full: string) => {
        const before = offset > 0 ? full[offset - 1] : '';
        const afterIndex = offset + match.length;
        const after = afterIndex < full.length ? full[afterIndex] : '';
        const beforeOk = before === '' || /[\s([{"'.,;:!?]/.test(before);
        const afterOk = after === '' || /[\s)\]}'".,;:!?]/.test(after);
        if (!beforeOk || !afterOk) return match;
        if (inner.trim().length === 0) return match;
        if (marker === '_' && /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(after)) {
          return match;
        }
        return inner;
      }
    );
    if (out === prev) break;
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}
