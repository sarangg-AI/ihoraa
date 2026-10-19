/** Shannon entropy in bits per character. Random keys score ~4+, words score ~2-3. */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const PLACEHOLDER_WORDS = [
  "your",
  "xxxx",
  "example",
  "placeholder",
  "changeme",
  "change_me",
  "dummy",
  "sample",
  "insert",
  "replace",
  "redacted",
  "todo",
  "fixme",
  "<",
  "${",
  "{{",
  "****",
  "....",
  "•", // already masked by Ihoraa
  "ihoraa_",
];

/** True for values that are obviously not real secrets: `your-api-key`, `xxx`, `<KEY>`. */
export function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_WORDS.some((w) => lower.includes(w))) return true;
  if (/^(.)\1+$/.test(value)) return true;
  // Env lookups and references are not secrets.
  if (/^(process\.env|import\.meta\.env|os\.environ|env\(|getenv)/i.test(value)) return true;
  return false;
}

// Inline files (`data:image/png;base64,…`) and references to a secret stored in a
// vault (AWS ARN, Google Secret Manager path, 1Password `op://`) look random but
// are not secrets. Hex strings and UUIDs are deliberately not listed: real API
// keys use those shapes too, so they are only skipped by variable name.
const NOT_A_SECRET_VALUE = /^(?:data:[\w.+-]+\/[\w.+-]+[;,]|arn:aws[\w-]*:|projects\/[^/]+\/secrets\/|op:\/\/)/i;

// Minified code caught between two unrelated quotes, e.g. `+A)}s=makeRequest({urlList:[t]});n=`.
// Generated keys never contain brackets or semicolons next to a function call.
function looksLikeCode(value: string): boolean {
  return /[{}[\];]/.test(value) && /[A-Za-z_$][\w$]{2,}\(/.test(value);
}

/**
 * Identifier-like text made of whole words, e.g. `?NonExpressionParenEnd` or
 * `,DuplicateBinding:`. Mixed case makes it look random, but random keys flip
 * case every couple of letters or contain digits.
 */
export function looksLikeWords(value: string): boolean {
  const core = value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (!core || /[^A-Za-z]/.test(core)) return false;
  const words = core.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) ?? [];
  return words.length >= 2 && core.length / words.length >= 4;
}

/** Generic secret heuristic: long enough, random enough and has mixed character classes. */
export function looksRandom(value: string): boolean {
  if (value.length < 16) return false;
  if (/\s/.test(value)) return false;
  // Skip URLs, paths and file names.
  if (/^(https?:|\/|\.\/|\.\.\/)/.test(value) || /\.(js|ts|tsx|json|png|svg|css|html)$/i.test(value)) return false;
  if (NOT_A_SECRET_VALUE.test(value) || looksLikeCode(value)) return false;
  const classes =
    Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/[0-9]/.test(value));
  if (classes < 2) return false;
  return shannonEntropy(value) >= 3.5;
}
