const BULLET = "•";

const KNOWN_PREFIX =
  /^(sk-ant-[a-z]+\d*-|sk-(?:proj|svcacct|admin)-|sk-|[sr]k_(?:live|test)_|sb_secret_|AKIA|ASIA|gh[pousr]_|github_pat_|xox[baprs]-|SG\.|AIza|hf_|gsk_|r8_|key-|eyJ|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

/** How many characters to leave visible at the start and end of a secret. */
function visibleEnds(secret: string): [number, number] {
  const db = /^([a-z+]+:\/\/[^:]+:)[^@]+(@.*)$/i.exec(secret);
  if (db) return [db[1].length, db[2].length];
  if (secret.startsWith("-----BEGIN")) {
    const end = secret.lastIndexOf("-----END");
    return [(KNOWN_PREFIX.exec(secret)?.[0].length ?? 10), end >= 0 ? secret.length - end : 0];
  }
  const prefix = KNOWN_PREFIX.exec(secret)?.[0].length ?? Math.min(4, Math.floor(secret.length / 6));
  const suffix = secret.length >= 20 ? 4 : 0;
  return [prefix, suffix];
}

function collapse(text: string): string {
  return text.replace(new RegExp(`${BULLET}{9,}`, "g"), BULLET.repeat(8));
}

/** Short, single-line masked form, e.g. `sk-proj-••••••••3fA9`. */
export function maskSecret(secret: string): string {
  const [start, end] = visibleEnds(secret);
  const middle = secret.slice(start, secret.length - end).replace(/[^\n]/g, BULLET).replace(/\n/g, "");
  const masked = collapse(secret.slice(0, start) + middle + (end ? secret.slice(secret.length - end) : ""));
  return masked.replace(/\s+/g, " ");
}

/**
 * Mask every secret range inside `content` while keeping line breaks, so line
 * numbers stay the same and snippets can be shown safely.
 */
export function maskRanges(content: string, ranges: { start: number; end: number; secret: string }[]): string {
  if (ranges.length === 0) return content;
  const chars = content.split("");
  for (const r of ranges) {
    const [keepStart, keepEnd] = visibleEnds(r.secret);
    for (let i = r.start + keepStart; i < r.end - keepEnd; i++) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = BULLET;
    }
  }
  return collapse(chars.join(""));
}
