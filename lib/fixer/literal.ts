import { concatOperator, type Lang } from "./language";

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface Literal {
  /** Start of the literal including any prefix like f"..." or r'...'. */
  start: number;
  end: number;
  quote: string;
  /** Delimiter length: 1 for "x", 3 for """x""". */
  delim: number;
  prefix: string;
}

/** What surrounds a position in a source file. */
export type Context = { kind: "code" } | { kind: "comment" } | { kind: "string"; open: number; quote: string; delim: number };

interface Syntax {
  lineComments: string[];
  blockComments: boolean;
  /** `#` only starts a comment at line start or after whitespace (YAML). */
  hashNeedsSpace: boolean;
  quotes: string[];
  /** Quote characters whose strings may span lines. */
  multiline: string[];
  /** Python-style """ and ''' strings. */
  triple: boolean;
}

function syntaxFor(lang: Lang): Syntax {
  const base: Syntax = { lineComments: [], blockComments: false, hashNeedsSpace: false, quotes: ['"', "'"], multiline: [], triple: false };
  switch (lang) {
    case "js":
    case "ts":
      return { ...base, lineComments: ["//"], blockComments: true, quotes: ['"', "'", "`"], multiline: ["`"] };
    case "go":
      return { ...base, lineComments: ["//"], blockComments: true, quotes: ['"', "'", "`"], multiline: ["`"] };
    case "java":
    case "cs":
      return { ...base, lineComments: ["//"], blockComments: true };
    case "rs":
      // Single quotes are lifetimes or chars in Rust, never strings.
      return { ...base, lineComments: ["//"], blockComments: true, quotes: ['"'] };
    case "php":
      return { ...base, lineComments: ["//", "#"], blockComments: true };
    case "py":
      return { ...base, lineComments: ["#"], triple: true };
    case "rb":
      return { ...base, lineComments: ["#"] };
    case "yaml":
      return { ...base, lineComments: ["#"], hashNeedsSpace: true };
    default:
      return base;
  }
}

/**
 * A small lexer: walks the file from the top and reports whether `offset` is
 * in code, a comment or a string. It is approximate (no regex literals, no
 * nested template expressions), but single-line strings end at the newline,
 * so a misread quote can never leak past its own line.
 */
export function contextAt(content: string, offset: number, lang: Lang): Context {
  const syn = syntaxFor(lang);
  let state: "code" | "line" | "block" | "string" = "code";
  let open = -1;
  let quote = "";
  let delim = 1;

  for (let i = 0; i < offset; i++) {
    const c = content[i];
    if (state === "code") {
      if (syn.blockComments && content.startsWith("/*", i)) {
        state = "block";
        i++;
      } else if (syn.lineComments.some((m) => content.startsWith(m, i)) && !(c === "#" && syn.hashNeedsSpace && i > 0 && !/\s/.test(content[i - 1]))) {
        state = "line";
      } else if (syn.triple && (content.startsWith('"""', i) || content.startsWith("'''", i))) {
        state = "string";
        open = i;
        quote = c;
        delim = 3;
        i += 2;
      } else if (syn.quotes.includes(c)) {
        state = "string";
        open = i;
        quote = c;
        delim = 1;
      }
    } else if (state === "line") {
      if (c === "\n") state = "code";
    } else if (state === "block") {
      if (content.startsWith("*/", i)) {
        state = "code";
        i++;
      }
    } else {
      const raw = lang === "go" && quote === "`";
      if (c === "\\" && !raw) i++;
      else if (delim === 3 && content.startsWith(quote.repeat(3), i)) {
        state = "code";
        i += 2;
      } else if (delim === 1 && c === quote) state = "code";
      else if (c === "\n" && delim === 1 && !syn.multiline.includes(quote)) state = "code";
    }
  }

  if (state === "line" || state === "block") return { kind: "comment" };
  if (state === "string") return { kind: "string", open, quote, delim };
  return { kind: "code" };
}

/** Index of the closing delimiter of the string opened at `open`, or -1. */
function stringEnd(content: string, open: number, quote: string, delim: number, lang: Lang): number {
  const multiline = delim === 3 || syntaxFor(lang).multiline.includes(quote);
  const raw = lang === "go" && quote === "`";
  for (let i = open + delim; i < content.length; i++) {
    const c = content[i];
    if (c === "\\" && !raw) i++;
    else if (content.startsWith(quote.repeat(delim), i)) return i;
    else if (c === "\n" && !multiline) return -1;
  }
  return -1;
}

/** The string literal that fully contains [start, end), or null. */
export function enclosingLiteral(content: string, start: number, end: number, lang: Lang): Literal | null {
  const ctx = contextAt(content, start, lang);
  if (ctx.kind !== "string") return null;
  const close = stringEnd(content, ctx.open, ctx.quote, ctx.delim, lang);
  if (close < end) return null; // unterminated, or the "secret" runs past the string
  let prefix = "";
  if (lang === "py") {
    const m = /[fFrRbBuU]{1,2}$/.exec(content.slice(Math.max(0, ctx.open - 2), ctx.open));
    if (m && !/\w/.test(content[ctx.open - m[0].length - 1] ?? "")) prefix = m[0];
  }
  return { start: ctx.open - prefix.length, end: close + ctx.delim, quote: ctx.quote, delim: ctx.delim, prefix };
}

/** True when the literal is a JSX attribute value, e.g. `apiKey="..."`. */
function isJsxAttribute(content: string, literalStart: number, lang: Lang, path: string): boolean {
  if (!/\.(jsx|tsx)$/.test(path) || (lang !== "js" && lang !== "ts")) return false;
  const lineStart = content.lastIndexOf("\n", literalStart - 1) + 1;
  const before = content.slice(lineStart, literalStart);
  return /(<[A-Za-z][^>]*\s|^\s*)[A-Za-z_][\w:-]*=$/.test(before) && !/\b(const|let|var)\s/.test(before);
}

export interface Replacement {
  start: number;
  end: number;
  expr: string;
}

/**
 * Rewrite one string literal so every secret inside it is read from the
 * environment. Handles any number of secrets in the same literal, e.g.
 * `"sk-... sk_live_..."`, in a single edit so nothing is left behind.
 */
export function rewriteLiteral(content: string, lit: Literal, replacements: Replacement[], lang: Lang, path: string): Edit {
  const parts = [...replacements].sort((a, b) => a.start - b.start);
  const innerStart = lit.start + lit.prefix.length + lit.delim;
  const innerEnd = lit.end - lit.delim;

  // Alternate text and expressions: ["Bearer ", expr, " ", expr, ""].
  const pieces: { text?: string; expr?: string }[] = [];
  let cursor = innerStart;
  for (const p of parts) {
    pieces.push({ text: content.slice(cursor, p.start) });
    pieces.push({ expr: p.expr });
    cursor = p.end;
  }
  pieces.push({ text: content.slice(cursor, innerEnd) });

  const jsx = isJsxAttribute(content, lit.start, lang, path);
  const wrap = (text: string) => ({ start: lit.start, end: lit.end, text: jsx ? `{${text}}` : text });
  const texts = pieces.filter((p) => p.text);

  // The whole literal is one secret: replace it outright.
  if (parts.length === 1 && texts.length === 0) return wrap(parts[0].expr);

  const open = lit.prefix + lit.quote.repeat(lit.delim);
  const close = lit.quote.repeat(lit.delim);
  const inline = (fmt: (e: string) => string) => ({
    start: lit.start,
    end: lit.end,
    text: open + pieces.map((p) => (p.expr !== undefined ? fmt(p.expr) : p.text)).join("") + close,
  });

  // Languages with string interpolation keep a single literal.
  if ((lang === "js" || lang === "ts") && lit.quote === "`") return inline((e) => `\${${e}}`);
  if (lang === "py" && /f/i.test(lit.prefix)) return inline((e) => `{${e.replace(/"/g, lit.quote === '"' ? "'" : '"')}}`);
  if (lang === "rb" && lit.quote === '"') return inline((e) => `#{${e}}`);
  if (lang === "yaml") return inline((e) => e);

  // Everything else: split into concatenated pieces.
  const op = ` ${concatOperator(lang)} `;
  const joined = pieces
    .filter((p) => p.expr !== undefined || p.text)
    .map((p) => (p.expr !== undefined ? p.expr : open + p.text + close))
    .join(op);
  return wrap(joined);
}

/**
 * Build the edit that swaps one secret for `expr` (code that reads an env var).
 * Returns null when the secret is not inside a string literal.
 */
export function replaceWithExpression(
  content: string,
  secret: { start: number; end: number },
  expr: string,
  lang: Lang,
  path: string,
): Edit | null {
  const lit = enclosingLiteral(content, secret.start, secret.end, lang);
  if (!lit) return null;
  return rewriteLiteral(content, lit, [{ ...secret, expr }], lang, path);
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
