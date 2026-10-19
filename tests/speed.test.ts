import { describe, expect, it } from "vitest";
import { analyze, BadRequest } from "../lib/analyze";
import type { Lang } from "../lib/fixer/language";
import { contextAt, ContextLexer } from "../lib/fixer/literal";
import { MAX_FINDINGS } from "../lib/scanner";
import { MAX_FILE_BYTES } from "../lib/scanner/walk";
import { fake } from "./fakes";

// Crafted uploads must not tie up the server. Each case is the largest file we
// accept, built to trigger slow regex backtracking or a flood of findings.
// The budget is generous so slower CI machines pass; regressions here were minutes.
const BUDGET_MS = 5_000;

const fill = (unit: string) => unit.repeat(Math.floor(MAX_FILE_BYTES / unit.length));

function nearLimit(): string {
  // MAX_FINDINGS - 1 distinct keys spread through a 1 MB file of ordinary code.
  const keys = Array.from({ length: MAX_FINDINGS - 1 }, () => `const stripe = new Stripe("${fake.stripeLive()}");\n`);
  const filler = "export const add = (a, b) => a + b;\n".repeat(Math.floor(MAX_FILE_BYTES / 36 / keys.length));
  return keys.map((k) => filler + k).join("").slice(0, MAX_FILE_BYTES);
}

const CASES: [string, string, () => string][] = [
  ["one long word", "server/a.js", () => fill("a")],
  ["minified code line", "server/a.js", () => fill("var a=function(b){return b+1};")],
  ["many sk- prefixes", "server/a.js", () => fill("sk-")],
  ["many eyJ- prefixes", "server/a.js", () => fill("eyJ-")],
  ["db urls without @", "server/a.js", () => fill("postgres://u:p")],
  ["private key BEGIN without END", "server/a.js", () => fill("-----BEGIN PRIVATE KEY-----")],
  ["many assignments", "server/a.js", () => fill("apiKey = x;")],
  ["thousands of keys", "server/a.js", () => fill(`k("${"sk_live_" + "a1B2c3D4e5F6g7H8i9J0"}");\n`)],
  ["thousands of generic secrets", "server/a.js", () => fill('const fooSecret = "aB3dE5fG7hJ9kL1mN3pQ";\n')],
  ["long .env line", ".env", () => "API_SECRET=" + fill("x")],
  ["thousands of .env lines", ".env", () => fill("APP_SECRET=aB3dE5fG7hJ9kL1mN3pQ\n")],
  ["just under the findings limit", "server/pay.js", nearLimit],
];

describe("scan speed on crafted uploads", () => {
  for (const [name, path, make] of CASES) {
    it(`finishes "${name}" quickly`, () => {
      const content = make();
      const t = performance.now();
      try {
        analyze({ projectName: "p", files: [{ path, content }] });
      } catch (err) {
        // Rejecting a flood of findings with a clear message is a fine outcome.
        expect(err).toBeInstanceOf(BadRequest);
      }
      expect(performance.now() - t).toBeLessThan(BUDGET_MS);
    }, 60_000);
  }

  it("gives the same answers with a shared, bookmarked lexer as with a fresh one", () => {
    const samples: [Lang, string][] = [
      ["ts", 'const a = "x\\"y"; // note "q"\n/* block \' */ const b = `multi\nline ${1}`;\nconst c = \'it\\\'s\';\n'],
      ["py", 'x = """doc\n"quoted" \'\'\' """\n# comment "x"\ny = f"{a}" + \'b\'\n'],
      ["yaml", 'key: "v#1" # real comment\nurl: http://x#frag\n'],
    ];
    for (const [lang, unit] of samples) {
      const content = unit.repeat(Math.ceil(40_000 / unit.length));
      const offsets = Array.from({ length: Math.floor(content.length / 97) }, (_, i) => i * 97 + (i % 5));
      offsets.sort(() => Math.random() - 0.5);
      const shared = new ContextLexer(content, lang);
      for (const o of offsets) expect(shared.at(o), `${lang} @${o}`).toEqual(contextAt(content, o, lang));
    }
  });

  it("rejects more findings than the limit with a plain-English message", () => {
    const content = Array.from({ length: MAX_FINDINGS + 1 }, () => `k("${fake.stripeLive()}");`).join("\n");
    expect(() => analyze({ projectName: "p", files: [{ path: "server/a.js", content }] })).toThrow(/more than 200 possible keys/);
  });
});
