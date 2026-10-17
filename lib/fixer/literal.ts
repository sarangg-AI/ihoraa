import { concatOperator, type Lang } from "./language";

export interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Literal {
  /** Start of the literal including any prefix like f"..." or r'...'. */
  start: number;
  end: number;
  quote: string;
  /** Delimiter length: 1 for "x", 3 for """x""". */
  delim: number;
  prefix: string;
}

/**
 * Find the string literal that contains [start, end). Looks for the nearest
 * quote before the secret on the same line and its partner after it. Template
 * literals and Python triple quotes may span lines (private keys often do).
 */
export function enclosingLiteral(content: string, start: number, end: number): Literal | null {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const before = content.slice(lineStart, start);
  let qs = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (`'"\``.includes(before[i])) {
      qs = lineStart + i;
      break;
    }
  }
  // Multi-line literal: the opening quote may be on an earlier line.
  if (qs < 0) {
    const back = Math.max(content.lastIndexOf("`", start - 1), content.lastIndexOf('"""', start - 1), content.lastIndexOf("'''", start - 1));
    if (back < 0) return null;
    qs = back + (content.startsWith('"""', back) || content.startsWith("'''", back) ? 2 : 0);
  }

  const quote = content[qs];
  let delim = 1;
  let open = qs;
  if (qs >= 2 && content.slice(qs - 2, qs + 1) === quote.repeat(3)) {
    delim = 3;
    open = qs - 2;
  }
  const closer = quote.repeat(delim);
  const qe = content.indexOf(closer, end);
  if (qe < 0) return null;
  // Single-quoted and double-quoted literals cannot span lines.
  if (delim === 1 && quote !== "`" && content.slice(end, qe).includes("\n")) return null;
  if (delim === 1 && quote !== "`" && content.slice(open, start).includes("\n")) return null;

  const prefixMatch = /[fFrRbBuU]{1,2}$/.exec(content.slice(Math.max(0, open - 2), open));
  const prefix = prefixMatch && !/\w/.test(content[open - prefixMatch[0].length - 1] ?? "") ? prefixMatch[0] : "";
  return { start: open - prefix.length, end: qe + delim, quote, delim, prefix };
}

/** True when the literal is a JSX attribute value, e.g. `apiKey="..."`. */
function isJsxAttribute(content: string, literalStart: number, lang: Lang, path: string): boolean {
  if (!/\.(jsx|tsx)$/.test(path) || (lang !== "js" && lang !== "ts")) return false;
  const lineStart = content.lastIndexOf("\n", literalStart - 1) + 1;
  const before = content.slice(lineStart, literalStart);
  return /(<[A-Za-z][^>]*\s|^\s*)[A-Za-z_][\w:-]*=$/.test(before) && !/\b(const|let|var)\s/.test(before);
}

/**
 * Build the edit that swaps the secret for `expr` (code that reads an env var).
 * Returns null when there is no literal we can safely rewrite.
 */
export function replaceWithExpression(
  content: string,
  secret: { start: number; end: number },
  expr: string,
  lang: Lang,
  path: string,
): Edit | null {
  const lit = enclosingLiteral(content, secret.start, secret.end);
  if (!lit) return null;
  const innerStart = lit.start + lit.prefix.length + lit.delim;
  const innerEnd = lit.end - lit.delim;
  const beforeText = content.slice(innerStart, secret.start);
  const afterText = content.slice(secret.end, innerEnd);

  // The whole literal is the secret: replace it outright.
  if (!beforeText && !afterText) {
    const text = isJsxAttribute(content, lit.start, lang, path) ? `{${expr}}` : expr;
    return { start: lit.start, end: lit.end, text };
  }

  // The secret is part of a bigger string such as "Bearer sk-...".
  if ((lang === "js" || lang === "ts") && lit.quote === "`") {
    return { start: secret.start, end: secret.end, text: `\${${expr}}` };
  }
  if (lang === "py" && /f/i.test(lit.prefix)) {
    const inner = expr.replace(/"/g, lit.quote === '"' ? "'" : '"');
    return { start: secret.start, end: secret.end, text: `{${inner}}` };
  }
  if (lang === "rb" && lit.quote === '"') {
    return { start: secret.start, end: secret.end, text: `#{${expr}}` };
  }
  if (lang === "yaml") {
    return { start: secret.start, end: secret.end, text: expr };
  }
  const op = ` ${concatOperator(lang)} `;
  const q = lit.prefix + lit.quote.repeat(lit.delim);
  const close = lit.quote.repeat(lit.delim);
  const parts = [beforeText ? q + beforeText + close : "", expr, afterText ? q + afterText + close : ""].filter(Boolean);
  const joined = parts.join(op);
  const text = isJsxAttribute(content, lit.start, lang, path) ? `{${joined}}` : joined;
  return { start: lit.start, end: lit.end, text };
}

/** Apply non-overlapping edits. Later edits are applied first so offsets stay valid. */
export function applyEdits(content: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = content;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

export function editsOverlap(a: Edit, b: Edit): boolean {
  if (a.start === a.end || b.start === b.end) return false; // pure insertions never clash
  return a.start < b.end && b.start < a.end;
}
