import { isGitIgnored } from "../scanner";

/** Parse KEY=value lines. Good enough to know which names already exist. */
export function parseEnv(content: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    vars.set(m[1], value.replace(/\\n/g, "\n"));
  }
  return vars;
}

export function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_\-./:@+=,]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function appendBlock(existing: string | undefined, title: string, lines: string[]): string {
  const base = existing ?? "";
  const sep = base === "" ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  return `${base}${sep}# ${title}\n${lines.join("\n")}\n`;
}

/** Add the moved secrets to .env, skipping names that already hold the same value. */
export function updateDotEnv(existing: string | undefined, vars: Map<string, string>): string | null {
  const current = existing ? parseEnv(existing) : new Map<string, string>();
  const lines: string[] = [];
  for (const [name, value] of vars) {
    if (current.get(name) === value) continue;
    lines.push(`${name}=${formatEnvValue(value)}`);
  }
  if (lines.length === 0) return null;
  return appendBlock(existing, "Added by Ihoraa. Keep this file private and never upload it.", lines);
}

/** .env.example documents which variables the app needs, with no real values. */
export function updateEnvExample(existing: string | undefined, names: string[]): string | null {
  const current = existing ? parseEnv(existing) : new Map<string, string>();
  const missing = names.filter((n) => !current.has(n));
  if (missing.length === 0) return null;
  return appendBlock(
    existing,
    "Added by Ihoraa. Copy this file to .env and fill in real values.",
    missing.map((n) => `${n}=`),
  );
}

export function updateGitignore(existing: string | undefined, envPaths: string[]): string | null {
  const targets = envPaths.length ? envPaths : [".env"];
  const needs = targets.some((p) => !isGitIgnored(existing, p)) || !isGitIgnored(existing, ".env");
  if (!needs) return null;
  return appendBlock(existing, "Secrets: added by Ihoraa", [".env", ".env*", "!.env.example"]);
}
