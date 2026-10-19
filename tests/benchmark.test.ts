import { describe, expect, it } from "vitest";
import { scanFiles } from "../lib/scanner";
import { isPlaceholder } from "../lib/scanner/entropy";
import type { RawFinding } from "../lib/types";
import { buildCorpus, type CorpusCase } from "./corpus";

// Accuracy ratchet. These are the scanner's numbers on the corpus today. A change
// may lower them (then lower them here too) but must never raise them.
const BASELINE = { misses: 0, falseAlarms: 0 };

interface Graded {
  c: CorpusCase;
  missed: string[];
  falseAlarms: RawFinding[];
}

const sameSecret = (f: RawFinding, s: string) => f.secret.includes(s) || s.includes(f.secret);

function grade(c: CorpusCase): Graded {
  const { findings } = scanFiles(c.files);
  return {
    c,
    missed: c.secrets.filter((s) => !findings.some((f) => sameSecret(f, s))),
    falseAlarms: findings.filter((f) => !c.secrets.some((s) => sameSecret(f, s))),
  };
}

function scorecard(results: Graded[]): string {
  const planted = results.reduce((n, r) => n + r.c.secrets.length, 0);
  const missed = results.reduce((n, r) => n + r.missed.length, 0);
  const alarms = results.reduce((n, r) => n + r.falseAlarms.length, 0);
  const cleanCases = results.filter((r) => r.c.kind === "clean");
  const noisyClean = cleanCases.filter((r) => r.falseAlarms.length > 0).length;

  const out = [
    "",
    "ihoraa accuracy benchmark",
    `  Secrets found:  ${planted - missed} of ${planted}`,
    `  False alarms:   ${alarms} (${noisyClean} of ${cleanCases.length} clean samples had at least one)`,
    "",
    "  By category:",
  ];
  const categories = [...new Set(results.map((r) => r.c.category))];
  for (const cat of categories) {
    const rs = results.filter((r) => r.c.category === cat);
    const ok = rs.filter((r) => r.missed.length === 0 && r.falseAlarms.length === 0).length;
    out.push(`    ${ok === rs.length ? "✓" : "✗"} ${cat.padEnd(16)} ${ok} of ${rs.length} samples correct`);
  }
  const failures = results.filter((r) => r.missed.length || r.falseAlarms.length);
  if (failures.length) out.push("", "  Problems:");
  for (const r of failures) {
    out.push(`    ✗ ${r.c.name}`);
    if (r.missed.length) out.push(`        missed ${r.missed.length} planted secret(s)`);
    // Masked values only: the benchmark output must never contain a raw secret.
    for (const f of r.falseAlarms) out.push(`        false alarm: ${f.file}:${f.line} ${f.ruleId} ${f.masked}`);
  }
  out.push("");
  return out.join("\n");
}

describe("accuracy benchmark", () => {
  const corpus = buildCorpus();
  const results = corpus.map(grade);

  it("has well-formed samples", () => {
    for (const c of corpus) {
      if (c.kind === "secret") expect(c.secrets.length, c.name).toBeGreaterThan(0);
      for (const s of c.secrets) expect(isPlaceholder(s), `${c.name} plants a placeholder`).toBe(false);
    }
    expect(new Set(corpus.map((c) => c.name)).size).toBe(corpus.length);
  });

  it("does no worse than the recorded baseline", () => {
    const card = scorecard(results);
    console.log(card);
    expect(card).not.toMatch(new RegExp(corpus.flatMap((c) => c.secrets).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")));

    const misses = results.reduce((n, r) => n + r.missed.length, 0);
    const falseAlarms = results.reduce((n, r) => n + r.falseAlarms.length, 0);
    expect(misses).toBeLessThanOrEqual(BASELINE.misses);
    expect(falseAlarms).toBeLessThanOrEqual(BASELINE.falseAlarms);
  });
});
