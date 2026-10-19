import type { Exposure, Framework, IgnoredFinding, RawFinding, Severity, SnippetLine, SourceFile } from "../types";
import { isPlaceholder, looksLikeWords, looksRandom } from "./entropy";
import { basename, classifyExposure, detectFramework, isEnvFile, isPublicEnvName, isTestOrExample } from "./exposure";
import { maskRanges, maskSecret } from "./mask";
import { RULES, SECRET_NAME, type Rule } from "./rules";
import { isScannable, looksBinary, normalizePath } from "./walk";

export interface ScanOutput {
  framework: Framework;
  files: SourceFile[];
  findings: RawFinding[];
  ignored: IgnoredFinding[];
  linesScanned: number;
}

interface Match {
  rule: Rule | GenericRule;
  secret: string;
  start: number;
  end: number;
  /** Variable name the secret is assigned to, when we can tell. */
  varName?: string;
}

type GenericRule = Omit<Rule, "pattern">;

const GENERIC_RULE: GenericRule = {
  id: "generic-secret",
  provider: "Unknown service",
  title: "Hard-coded secret",
  severity: "medium",
  confidence: "medium",
  whatItCanDo: "This looks like a password or API key. Whoever finds it can use the service it unlocks as you.",
  envName: "SECRET_KEY",
};

const ENV_FILE_RULE: GenericRule = {
  ...GENERIC_RULE,
  id: "env-file-secret",
  title: "Secret in an unprotected .env file",
  whatItCanDo:
    "Your .env file is not listed in .gitignore, so this value gets uploaded to GitHub with the rest of your code.",
  severity: "high",
};

// `apiKey: "..."`, `const SECRET = '...'`, `"token": "..."`, `password := "..."`.
const ASSIGNMENT =
  /(?<name>[A-Za-z_$][\w$-]{0,60})['"]?\s*(?::=|=>|:|=)\s*(?<q>['"`])(?<value>[^'"`\s\\]{16,300})\k<q>/g;
const ENV_LINE = /^[ \t]*(?:export[ \t]+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?<q>['"]?)(?<value>[^\r\n'"#]*?)\k<q>[ \t]*(?:#.*)?$/gm;
const NOT_SECRET_NAME = /(public|publishable|anon|_url$|url$|_id$|endpoint|host|region|name$|path|file|length|size|type)/i;
// The value is a hash of a secret or an identifier pointing at one: `passwordHash`,
// `tokenChecksum`, `apiKeyId`, `SECRET_REF`. CamelCase `Id`/`Ref`/`Arn` is checked
// case-sensitively so names like `GOOGLE_KEY_ANDROID` still count as secrets.
const HASH_OR_ID_NAME = /(?:hash|checksum|digest|fingerprint|sha\d*|md5|uuid|guid)$|(?:^|[_-])(?:ids?|refs?|arn)$/i;
const CAMEL_ID_NAME = /[a-z\d](?:Ids?|Refs?|Arn)$/;

// .env settings that sit next to secrets: `TOKEN_EXPIRY=30d`, `API_KEY_HEADER=Authorization`.
const SETTING_NAME = /_(?:ttl|expiry|expires(?:_in)?|expiration|timeout|max_age|header|algo|algorithm|issuer|audience)$/i;
const FLAG_VALUE = /^(?:true|false|yes|no|on|off|enabled|disabled|none|null)$/i;
const DURATION_VALUE = /^\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y)$/i;
const NUMBER_VALUE = /^-?\d+(?:\.\d+)?$/;

/** A URL with no password, no query string and no random-looking path segment (unlike webhook URLs). */
function isPlainUrl(value: string): boolean {
  const m = /^(?:https?|wss?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(value);
  if (!m || m[1].includes("@")) return false;
  return !(m[2] ?? "").split("/").some(looksRandom);
}

/** True for `.env` values that configure something rather than unlock it. */
function isSettingValue(name: string, value: string): boolean {
  if (SETTING_NAME.test(name) || FLAG_VALUE.test(value) || DURATION_VALUE.test(value) || isPlainUrl(value)) return true;
  // `SESSION_TTL=86400` is a setting, `ADMIN_PASSWORD=12345678` is a weak password.
  return NUMBER_VALUE.test(value) && !/passw|pwd/i.test(name);
}

/** True when a variable name suggests its value is a secret. */
function isSecretName(name: string): boolean {
  if (!SECRET_NAME.test(name) || NOT_SECRET_NAME.test(name)) return false;
  return !HASH_OR_ID_NAME.test(name) && !CAMEL_ID_NAME.test(name);
}

// A developer's "I checked, this is not a secret" marker, on any line the match
// touches. `gitleaks:allow` is the same marker used by the Gitleaks scanner.
const NOT_SECRET_MARKER = /\bihoraa-ignore\b|\bgitleaks:allow\b/;

function isMarkedNotSecret(content: string, start: number, end: number): boolean {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = content.indexOf("\n", end);
  return NOT_SECRET_MARKER.test(content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd));
}

function lineIndex(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts.push(i + 1);
  return starts;
}

function position(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

function overlaps(taken: Match[], start: number, end: number): boolean {
  return taken.some((m) => start < m.end && end > m.start);
}

/** Minimal .gitignore matcher: enough to tell whether `.env` files are ignored. */
export function isGitIgnored(gitignore: string | undefined, path: string): boolean {
  if (!gitignore) return false;
  const name = basename(path);
  let ignored = false;
  for (const raw of gitignore.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    line = line.replace(/^\/+/, "").replace(/\/+$/, "");
    const target = line.includes("/") ? path : name;
    const re = new RegExp(
      "^" + line.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$",
    );
    if (re.test(target)) ignored = !negate;
  }
  return ignored;
}

function toEnvName(varName: string): string {
  const snake = varName
    .replace(/^[^A-Za-z]+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase()
    .replace(/^_+|_+$/g, "");
  if (!snake || /^(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|AUTH)$/.test(snake)) return `APP_${snake || "SECRET"}`;
  return snake;
}

/**
 * More possible keys than any real project has; it usually means data files,
 * logs or generated code. Stopping early also keeps scan and fix fast, since
 * their work grows with the number of findings.
 */
export const MAX_FINDINGS = 200;

export class TooManyFindings extends Error {
  constructor() {
    super(
      `This project has more than ${MAX_FINDINGS} possible keys, which usually means it includes data files, logs or generated code. ` +
        "Zip just your app's source folder and try again.",
    );
  }
}

function findMatches(file: SourceFile, envFile: boolean, budget: number): Match[] {
  const found: Match[] = [];
  const { content } = file;
  const add = (m: Match) => {
    if (found.length >= budget) throw new TooManyFindings();
    found.push(m);
  };

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("d") ? rule.pattern.flags : rule.pattern.flags + "d");
    for (const m of content.matchAll(re)) {
      const group = m.indices?.groups?.secret;
      const [start, end] = group ?? [m.index, m.index + m[0].length];
      const secret = content.slice(start, end);
      if (isPlaceholder(secret)) continue;
      if (rule.validate && !rule.validate(secret)) continue;
      if (overlaps(found, start, end)) continue;
      add({ rule, secret, start, end });
    }
  }

  if (envFile) {
    for (const m of content.matchAll(new RegExp(ENV_LINE.source, "gmd"))) {
      const name = m.groups!.name;
      const value = m.groups!.value.trim();
      const [vs] = m.indices!.groups!.value;
      const start = vs + m.groups!.value.indexOf(value);
      const end = start + value.length;
      const known = found.find((f) => start < f.end && end > f.start);
      if (known) {
        known.varName = name;
        continue;
      }
      if (!isSecretName(name)) continue;
      if (value.length < 8 || isPlaceholder(value) || isSettingValue(name, value)) continue;
      add({ rule: ENV_FILE_RULE, secret: value, start, end, varName: name });
    }
    return found;
  }

  // Made-up values are normal in tests and examples. Provider-format keys above
  // are still reported there: a real key is leaked wherever it sits.
  if (isTestOrExample(file.path)) return found;

  for (const m of content.matchAll(new RegExp(ASSIGNMENT.source, "gd"))) {
    const name = m.groups!.name;
    const value = m.groups!.value;
    const [start, end] = m.indices!.groups!.value;
    const known = found.find((f) => start <= f.start && end >= f.end);
    if (known) {
      known.varName ??= name;
      continue;
    }
    if (!isSecretName(name)) continue;
    if (isPlaceholder(value) || !looksRandom(value)) continue;
    // `tokenType = "?InterpolationInJSX"` is an identifier, but a wordy password is still a password.
    if (looksLikeWords(value) && !/passw|pwd/i.test(name)) continue;
    if (overlaps(found, start, end)) continue;
    add({ rule: GENERIC_RULE, secret: value, start, end, varName: name });
  }
  return found;
}

function buildSnippet(lines: string[], line: number): SnippetLine[] {
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 2);
  const out: SnippetLine[] = [];
  for (let n = from; n <= to; n++) {
    let text = lines[n - 1];
    if (text.length > 180) text = text.slice(0, 177) + "...";
    out.push({ line: n, text, highlight: n === line });
  }
  return out;
}

function finalSeverity(rule: Match["rule"], exposure: Exposure): Severity {
  if (exposure === "frontend" && !rule.publicByDesign) return "critical";
  return rule.severity;
}

export function scanFiles(input: SourceFile[]): ScanOutput {
  const files = input
    .map((f) => ({ path: normalizePath(f.path), content: f.content }))
    .filter((f) => isScannable(f.path, f.content.length) && !looksBinary(f.content));
  const framework = detectFramework(files);
  const gitignore = files.find((f) => f.path === ".gitignore")?.content;

  const findings: RawFinding[] = [];
  const ignored: IgnoredFinding[] = [];
  const envNameBySecret = new Map<string, string>();
  const usedEnvNames = new Map<string, string>(); // envName -> secret
  let linesScanned = 0;
  let budget = MAX_FINDINGS;

  const assignEnvName = (secret: string, wanted: string): string => {
    const existing = envNameBySecret.get(secret);
    if (existing) return existing;
    let name = wanted;
    for (let i = 2; usedEnvNames.has(name) && usedEnvNames.get(name) !== secret; i++) name = `${wanted}_${i}`;
    usedEnvNames.set(name, secret);
    envNameBySecret.set(secret, name);
    return name;
  };

  // Scan .env files first so code findings can reuse the variable names already there.
  const ordered = [...files].sort((a, b) => Number(isEnvFile(b.path)) - Number(isEnvFile(a.path)));

  for (const file of ordered) {
    linesScanned += file.content.split("\n").length;
    const envFile = isEnvFile(file.path);
    const ignoredEnv = envFile && isGitIgnored(gitignore, file.path);
    const baseExposure = classifyExposure(file, framework);
    const matches = findMatches(file, envFile, budget).sort((a, b) => a.start - b.start);
    budget -= matches.length;
    if (matches.length === 0) continue;

    const starts = lineIndex(file.content);
    const maskedLines = maskRanges(file.content, matches).split(/\r?\n/);

    for (const m of matches) {
      let exposure = baseExposure;
      let rule = m.rule;
      const publicVar = m.varName ? isPublicEnvName(m.varName) : false;

      if (envFile) {
        if (publicVar && !rule.publicByDesign) {
          // NEXT_PUBLIC_/VITE_ variables are copied into the browser bundle.
          exposure = "frontend";
        } else if (ignoredEnv) {
          // A gitignored .env file is exactly where secrets belong. Remember the
          // name so code that hard-codes the same value reuses this variable.
          if (m.varName) assignEnvName(m.secret, m.varName);
          continue;
        }
      }

      const { line, column } = position(starts, m.start);
      if (isMarkedNotSecret(file.content, m.start, m.end)) {
        ignored.push({ file: file.path, line });
        continue;
      }
      const wantedName =
        envFile && m.varName ? m.varName : rule.id === "generic-secret" && m.varName ? toEnvName(m.varName) : rule.envName;
      const envName = assignEnvName(m.secret, wantedName);
      const severity = finalSeverity(rule, exposure);
      if (envFile && rule.id === "env-file-secret" && exposure === "frontend") {
        rule = { ...rule, title: "Secret in a public env variable" };
      }

      findings.push({
        id: `${file.path}:${m.start}`,
        ruleId: rule.id,
        provider: rule.provider,
        title: rule.title,
        whatItCanDo: rule.whatItCanDo,
        severity,
        confidence: rule.confidence ?? "high",
        exposure,
        file: file.path,
        line,
        column,
        masked: maskSecret(m.secret),
        snippet: buildSnippet(maskedLines, line),
        envName,
        publicByDesign: Boolean(rule.publicByDesign),
        rotateUrl: rule.rotateUrl,
        fixSummary: "",
        secret: m.secret,
        start: m.start,
        end: m.end,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  ignored.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { framework, files, findings, ignored, linesScanned };
}

/** 100 = nothing found. Each unique leaked secret costs points by severity. */
export function securityScore(findings: RawFinding[]): number {
  const cost: Record<Severity, number> = { critical: 30, high: 15, medium: 6 };
  const worst = new Map<string, Severity>();
  for (const f of findings) {
    const prev = worst.get(f.secret);
    if (!prev || cost[f.severity] > cost[prev]) worst.set(f.secret, f.severity);
  }
  let score = 100;
  for (const s of worst.values()) score -= cost[s];
  return Math.max(0, Math.min(100, score));
}
