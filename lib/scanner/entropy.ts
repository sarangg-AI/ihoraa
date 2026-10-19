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

/** Generic secret heuristic: long enough, random enough and has mixed character classes. */
export function looksRandom(value: string): boolean {
  if (value.length < 16) return false;
  if (/\s/.test(value)) return false;
  // Skip URLs, paths and file names.
  if (/^(https?:|\/|\.\/|\.\.\/)/.test(value) || /\.(js|ts|tsx|json|png|svg|css|html)$/i.test(value)) return false;
  if (NOT_A_SECRET_VALUE.test(value)) return false;
  const classes =
    Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/[0-9]/.test(value));
  if (classes < 2) return false;
  return shannonEntropy(value) >= 3.5;
}
