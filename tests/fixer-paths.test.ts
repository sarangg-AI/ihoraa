import ts from "typescript";
import { describe, expect, it } from "vitest";
import { analyze } from "../lib/analyze";
import { MOVED_TO_SERVER, REPORT_PATH } from "../lib/fixer";
import { formatEnvValue, parseEnv, updateDotEnv, updateEnvExample, updateGitignore } from "../lib/fixer/envfiles";
import type { SourceFile } from "../lib/types";
import { fake } from "./fakes";

function run(files: SourceFile[]) {
  const { result, fix } = analyze({ projectName: "demo", files });
  const out = new Map(files.map((f) => [f.path, f.content]));
  for (const f of fix.files) out.set(f.path, f.content);
  const added = fix.files.map((f) => f.path).filter((p) => !files.some((f) => f.path === p));
  return { result, fix, out, added };
}

/** Syntax-check generated code. Type errors are ignored: the user's project has its own types. */
function syntaxErrors(source: string, fileName: string): string[] {
  const out = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

const NEXT = { path: "package.json", content: '{"dependencies":{"next":"16"}}' };
const VITE = { path: "package.json", content: '{"dependencies":{"vite":"6"}}' };

describe("proxy routes for AI keys in browser code", () => {
  const cases: { name: string; files: SourceFile[]; route: string }[] = [
    { name: "Next.js app router", files: [NEXT, { path: "app/page.tsx", content: "" }], route: "app/api/ihoraa/{slug}/route.ts" },
    { name: "Next.js src/app", files: [NEXT, { path: "src/app/page.tsx", content: "" }], route: "src/app/api/ihoraa/{slug}/route.ts" },
    { name: "Next.js pages router", files: [NEXT, { path: "pages/index.tsx", content: "" }], route: "pages/api/ihoraa/{slug}.ts" },
    { name: "Vite (Vercel function)", files: [VITE], route: "api/ihoraa/{slug}.js" },
  ];
  const providers = [
    { slug: "openai", make: fake.openai, env: "OPENAI_API_KEY", header: "authorization: `Bearer ${key}`" },
    { slug: "anthropic", make: fake.anthropic, env: "ANTHROPIC_API_KEY", header: '"x-api-key": key' },
    { slug: "groq", make: fake.groq, env: "GROQ_API_KEY", header: "authorization: `Bearer ${key}`" },
  ];

  for (const c of cases) {
    for (const p of providers) {
      it(`${c.name}: ${p.slug}`, () => {
        const code = `"use client";\nconst client = makeClient({ apiKey: "${p.make()}" });\n`;
        const { out, added, result } = run([...c.files, { path: "components/Chat.jsx", content: code }]);
        const route = c.route.replace("{slug}", p.slug);
        expect(added).toContain(route);
        const source = out.get(route)!;
        expect(source).toContain(`process.env.${p.env}`);
        expect(source).toContain(p.header);
        expect(syntaxErrors(source, route)).toEqual([]);
        expect(out.get("components/Chat.jsx")).toContain(`"${MOVED_TO_SERVER}"`);
        expect(result.plan.manualSteps.find((m) => m.file === "components/Chat.jsx")?.aiPrompt).toContain(`/api/ihoraa/${p.slug}`);
      });
    }
  }

  it("sends the Anthropic version header", () => {
    const { out } = run([NEXT, { path: "app/page.tsx", content: "" }, { path: "components/C.jsx", content: `"use client";\nk("${fake.anthropic()}");\n` }]);
    expect(out.get("app/api/ihoraa/anthropic/route.ts")).toContain('"anthropic-version": "2023-06-01"');
  });

  it("creates one proxy per provider even when the key appears twice", () => {
    const key = fake.openai();
    const { added } = run([
      NEXT,
      { path: "app/page.tsx", content: "" },
      { path: "components/A.jsx", content: `"use client";\na("${key}");\n` },
      { path: "components/B.jsx", content: `"use client";\nb("${key}");\n` },
    ]);
    expect(added.filter((p) => p.includes("ihoraa/openai"))).toHaveLength(1);
  });
});

describe("other browser-code cases", () => {
  it("asks to move non-AI secrets to the server, without a proxy", () => {
    const { out, added, result } = run([NEXT, { path: "components/Pay.tsx", content: `"use client";\nconst stripe = Stripe("${fake.stripeLive()}");\n` }]);
    expect(out.get("components/Pay.tsx")).toBe(
      `"use client";\n// TODO(ihoraa): secret key removed from browser code. See ${REPORT_PATH}.\nconst stripe = Stripe("${MOVED_TO_SERVER}");\n`,
    );
    expect(added.some((p) => p.includes("api/ihoraa"))).toBe(false);
    const step = result.plan.manualSteps.find((m) => m.file === "components/Pay.tsx")!;
    expect(step.title).toBe("Move the Stripe code in components/Pay.tsx to your server");
    expect(step.aiPrompt).toContain("STRIPE_SECRET_KEY");
  });

  it("does not add a TODO comment inside JSX markup", () => {
    const { out } = run([NEXT, { path: "components/W.tsx", content: `"use client";\nexport const W = () => (\n  <Widget apiKey="${fake.openai()}" />\n);\n` }]);
    const w = out.get("components/W.tsx")!;
    expect(w).not.toContain("TODO(ihoraa)");
    expect(w).toContain(`<Widget apiKey="${MOVED_TO_SERVER}" />`);
  });

  it("leaves browser-safe keys in plain HTML and asks to restrict them", () => {
    const key = fake.google();
    const { out, result } = run([{ path: "index.html", content: `<script src="https://maps.example.com/js?key=${key}"></script>\n` }]);
    expect(out.get("index.html")).toContain(key);
    expect(result.findings[0].fixSummary).toMatch(/meant to be public/);
    expect(result.plan.rotations[0].steps.join(" ")).toMatch(/Restrict the key/);
  });

  it("asks to rename public env variables that hold secrets", () => {
    const { result, fix } = run([
      { path: ".env.local", content: `NEXT_PUBLIC_OPENAI_KEY=${fake.openai()}\n` },
      { path: ".gitignore", content: ".env*\n" },
    ]);
    const step = result.plan.manualSteps.find((m) => m.title === "Stop sending NEXT_PUBLIC_OPENAI_KEY to the browser")!;
    expect(step.aiPrompt).toContain("Rename it to OPENAI_KEY");
    // Nothing in the code changes, and an already-ignored .env needs no .gitignore edit.
    expect(fix.files.map((f) => f.path)).toEqual([REPORT_PATH]);
  });
});

describe("server code in other languages", () => {
  const s = fake.stripeLive();
  const cases: [string, string, string][] = [
    ["server/pay.rb", `KEY = "${s}"\n`, 'KEY = ENV["STRIPE_SECRET_KEY"]\n'],
    ["server/auth.rb", `h = "Bearer ${s}"\n`, 'h = "Bearer #{ENV["STRIPE_SECRET_KEY"]}"\n'],
    ["server/pay.php", `<?php $k = '${s}';\n`, "<?php $k = getenv('STRIPE_SECRET_KEY');\n"],
    ["server/auth.php", `<?php $h = "Bearer ${s}";\n`, "<?php $h = \"Bearer \" . getenv('STRIPE_SECRET_KEY');\n"],
    ["server/main.go", `key := "${s}"\n`, 'key := os.Getenv("STRIPE_SECRET_KEY")\n'],
    ["server/Pay.java", `String k = "${s}";\n`, 'String k = System.getenv("STRIPE_SECRET_KEY");\n'],
    ["server/Pay.cs", `var k = "${s}";\n`, 'var k = Environment.GetEnvironmentVariable("STRIPE_SECRET_KEY");\n'],
    ["server/pay.rs", `let k = "${s}";\n`, 'let k = std::env::var("STRIPE_SECRET_KEY").unwrap();\n'],
  ];
  for (const [path, before, after] of cases) {
    it(path, () => {
      const { out } = run([{ path, content: before }]);
      expect(out.get(path)).toBe(after);
      expect(out.get(".env")).toContain(`STRIPE_SECRET_KEY=${s}`);
    });
  }

  it("places `import os` after a shebang and __future__ imports", () => {
    const { out } = run([{ path: "tool.py", content: `#!/usr/bin/env python\nfrom __future__ import annotations\nK = "${fake.openai()}"\n` }]);
    expect(out.get("tool.py")).toBe('#!/usr/bin/env python\nfrom __future__ import annotations\nimport os\nK = os.environ["OPENAI_API_KEY"]\n');
  });

  it("falls back to a placeholder in JSON config", () => {
    const { out, result } = run([{ path: "config.json", content: `{ "openaiKey": "${fake.openai()}" }\n` }]);
    expect(out.get("config.json")).toBe('{ "openaiKey": "IHORAA_MOVED_TO_ENV_OPENAI_API_KEY" }\n');
    expect(result.plan.manualSteps.map((m) => m.title)).toContain("Load OPENAI_API_KEY in config.json");
  });
});

describe("private keys", () => {
  it("moves a multi-line key into .env and keeps it out of the preview", () => {
    const pem = fake.privateKey();
    const { out, result } = run([{ path: "server/sign.js", content: "const key = `" + pem + "`;\n" }]);
    expect(out.get("server/sign.js")).toBe("const key = process.env.PRIVATE_KEY;\n");
    const env = out.get(".env")!;
    expect(env).toContain('PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n');
    expect(parseEnv(env).get("PRIVATE_KEY")).toBe(pem);
    // Neither the raw nor the escaped form may appear in the diff sent to the browser.
    const plan = JSON.stringify(result.plan);
    for (const line of pem.split("\n").slice(1, -1)) expect(plan).not.toContain(line);
  });
});

describe("env file helpers", () => {
  it("quotes values only when needed", () => {
    expect(formatEnvValue("sk_live_abc123")).toBe("sk_live_abc123");
    expect(formatEnvValue("has space")).toBe('"has space"');
    expect(formatEnvValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(formatEnvValue("a\nb")).toBe('"a\\nb"');
  });

  it("appends new variables and skips ones that already match", () => {
    const existing = "A=1\nB=2\n";
    expect(updateDotEnv(existing, new Map([["A", "1"]]))).toBeNull();
    const next = updateDotEnv(existing, new Map([["A", "1"], ["C", "3"]]))!;
    expect(next.startsWith(existing)).toBe(true);
    expect(next).toContain("\nC=3\n");
    expect(next).not.toMatch(/\nA=1\n.*\nA=1/s);
    expect(updateDotEnv(undefined, new Map([["X", "y"]]))).toMatch(/^# .*\nX=y\n$/);
  });

  it("documents only missing names in .env.example", () => {
    expect(updateEnvExample("A=\n", ["A"])).toBeNull();
    expect(updateEnvExample("A=\n", ["A", "B"])).toMatch(/\nB=\n$/);
  });

  it("only touches .gitignore when .env is not ignored yet", () => {
    expect(updateGitignore(".env*\n", [".env"])).toBeNull();
    expect(updateGitignore("node_modules\n", [".env"])).toContain(".env*");
    expect(updateGitignore(".env\n", [".env", ".env.production"])).toContain("!.env.example");
  });
});
