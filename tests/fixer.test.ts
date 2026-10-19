import { describe, expect, it } from "vitest";
import { analyze } from "../lib/analyze";
import { MOVED_TO_SERVER, REPORT_PATH } from "../lib/fixer";
import { replaceWithExpression, applyEdits } from "../lib/fixer/literal";
import type { SourceFile } from "../lib/types";
import { fake } from "./fakes";

function run(files: SourceFile[]) {
  const { result, fix } = analyze({ projectName: "demo", files });
  const out = new Map(files.map((f) => [f.path, f.content]));
  for (const f of fix.files) out.set(f.path, f.content);
  return { result, fix, out };
}

/** Apply the fix, then scan the fixed project again. */
function rescan(files: SourceFile[]) {
  const { out } = run(files);
  return analyze({ projectName: "demo", files: [...out].map(([path, content]) => ({ path, content })) }).result;
}

/** Every raw secret must be gone from every output file except .env. */
function expectNoLeak(files: SourceFile[]) {
  const { fix, out } = run(files);
  for (const secret of new Set(fix.findings.map((f) => f.secret))) {
    for (const [path, content] of out) {
      if (path === ".env") continue;
      expect(content.includes(secret), `${path} still contains a raw secret`).toBe(false);
    }
  }
  expect(rescan(files).findings).toEqual([]);
  return { ...run(files) };
}

const rewrite = (code: string, secret: string, lang: "js" | "ts" | "py", path: string, expr: string) => {
  const start = code.indexOf(secret);
  const edit = replaceWithExpression(code, { start, end: start + secret.length }, expr, lang, path)!;
  return applyEdits(code, [edit]);
};

describe("literal rewriting", () => {
  const s = "SECRETVALUE123456";
  it("replaces a whole literal", () => {
    expect(rewrite(`const k = "${s}";`, s, "js", "a.js", "process.env.K")).toBe("const k = process.env.K;");
    expect(rewrite(`k = '${s}'`, s, "py", "a.py", 'os.environ["K"]')).toBe('k = os.environ["K"]');
  });
  it("splits a literal that contains more text", () => {
    expect(rewrite(`h = { Authorization: "Bearer ${s}" }`, s, "js", "a.js", "process.env.K")).toBe(
      'h = { Authorization: "Bearer " + process.env.K }',
    );
  });
  it("interpolates inside template literals and f-strings", () => {
    expect(rewrite("h = `Bearer " + s + "`", s, "js", "a.js", "process.env.K")).toBe("h = `Bearer ${process.env.K}`");
    expect(rewrite(`h = f"Bearer ${s}"`, s, "py", "a.py", 'os.environ["K"]')).toBe(`h = f"Bearer {os.environ['K']}"`);
  });
  it("wraps JSX attributes in braces", () => {
    expect(rewrite(`<Map apiKey="${s}" />`, s, "ts", "a.tsx", "process.env.K!")).toBe("<Map apiKey={process.env.K!} />");
  });
});

describe("buildFix", () => {
  it("moves a server-side key to .env and secures .gitignore", () => {
    const secret = fake.stripeLive();
    const { result, out } = run([
      { path: "package.json", content: '{"dependencies":{"express":"4"}}' },
      { path: "server/pay.js", content: `const stripe = require("stripe")("${secret}");\n` },
    ]);
    expect(result.findings).toHaveLength(1);
    expect(out.get("server/pay.js")).toBe('const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);\n');
    expect(out.get(".env")).toContain(`STRIPE_SECRET_KEY=${secret}`);
    expect(out.get(".env.example")).toContain("STRIPE_SECRET_KEY=\n");
    expect(out.get(".gitignore")).toContain(".env*");
    expect(out.get(REPORT_PATH)).toContain("Rotate your keys");
    expect(result.plan.rotations[0].provider).toBe("Stripe");
  });

  it("adds `import os` to Python files", () => {
    const secret = fake.openai();
    const { out } = run([{ path: "main.py", content: `from openai import OpenAI\nclient = OpenAI(api_key="${secret}")\n` }]);
    expect(out.get("main.py")).toBe('import os\nfrom openai import OpenAI\nclient = OpenAI(api_key=os.environ["OPENAI_API_KEY"])\n');
  });

  it("removes AI keys from browser code and generates a proxy route", () => {
    const secret = fake.openai();
    const { result, out } = run([
      { path: "package.json", content: '{"dependencies":{"next":"16.0.0"}}' },
      { path: "app/page.tsx", content: "export default function Page() { return null }\n" },
      { path: "components/Chat.tsx", content: `"use client";\nconst openai = new OpenAI({ apiKey: "${secret}", dangerouslyAllowBrowser: true });\n` },
    ]);
    const chat = out.get("components/Chat.tsx")!;
    expect(chat).not.toContain(secret);
    expect(chat).toContain(MOVED_TO_SERVER);
    expect(chat).toContain("// TODO(ihoraa)");
    const proxy = out.get("app/api/ihoraa/openai/route.ts")!;
    expect(proxy).toContain("process.env.OPENAI_API_KEY");
    expect(proxy).toContain("export async function POST");
    expect(out.get(".env")).toContain(`OPENAI_API_KEY=${secret}`);
    expect(result.plan.manualSteps.some((s) => s.aiPrompt?.includes("/api/ihoraa/openai"))).toBe(true);
  });

  it("uses public env prefixes for browser-safe keys", () => {
    const secret = fake.google();
    const { out } = run([
      { path: "package.json", content: '{"dependencies":{"vite":"6"}}' },
      { path: "src/firebase.js", content: `export const config = { apiKey: "${secret}" };\n` },
    ]);
    expect(out.get("src/firebase.js")).toBe("export const config = { apiKey: import.meta.env.VITE_GOOGLE_API_KEY };\n");
    expect(out.get(".env")).toContain("VITE_GOOGLE_API_KEY=");
  });

  it("never sends raw secrets in the public result", () => {
    const secret = fake.openai();
    const { result } = run([{ path: "server/a.js", content: `const k = "${secret}";` }]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns an empty plan for a clean project", () => {
    const { result, fix } = run([{ path: "index.js", content: "console.log('hi')" }]);
    expect(result.score).toBe(100);
    expect(fix.files).toHaveLength(0);
  });

  it("leaves no findings when the fixed project is scanned again", () => {
    const files: SourceFile[] = [
      { path: "package.json", content: '{"dependencies":{"next":"16.0.0"}}' },
      { path: "app/layout.tsx", content: "export default function L({children}) { return children }\n" },
      { path: "components/Chat.tsx", content: `"use client";\nconst key = "${fake.openai()}";\n` },
      { path: "app/api/pay/route.ts", content: `const stripe = new Stripe("${fake.stripeLive()}");\nconst db = "${fake.dbUrl()}";\n` },
      { path: "scripts/seed.py", content: `TOKEN = "${fake.github()}"\nheaders = {"Authorization": f"token {TOKEN}"}\n` },
      { path: ".env", content: `SUPABASE_SERVICE_ROLE_KEY=${fake.supabaseService()}\n` },
      { path: "README.md", content: `Use key ${fake.anthropic()} to test.\n` },
    ];
    const first = analyze({ projectName: "demo", files }).result;
    expect(first.findings.length).toBeGreaterThanOrEqual(6);
    const second = rescan(files);
    expect(second.findings).toEqual([]);
    expect(second.score).toBe(100);
  });
});

describe("regressions", () => {
  describe("several keys in one string", () => {
    it("rewrites both keys in a JS string", () => {
      const o = fake.openai();
      const s = fake.stripeLive();
      const { out, result } = expectNoLeak([{ path: "server/a.js", content: `const both = "${o} ${s}";\n` }]);
      expect(out.get("server/a.js")).toBe('const both = process.env.OPENAI_API_KEY + " " + process.env.STRIPE_SECRET_KEY;\n');
      expect(result.plan.manualSteps.map((m) => m.title)).not.toContain("Load STRIPE_SECRET_KEY in server/a.js");
    });

    it("rewrites both keys in a template literal and a Python string", () => {
      const o = fake.openai();
      const s = fake.stripeLive();
      const js = expectNoLeak([{ path: "server/t.js", content: "const both = `" + o + ":" + s + "`;\n" }]).out;
      expect(js.get("server/t.js")).toBe("const both = `${process.env.OPENAI_API_KEY}:${process.env.STRIPE_SECRET_KEY}`;\n");
      const py = expectNoLeak([{ path: "app.py", content: `CREDS = "${o}:${s}"\n` }]).out;
      expect(py.get("app.py")).toBe('import os\nCREDS = os.environ["OPENAI_API_KEY"] + ":" + os.environ["STRIPE_SECRET_KEY"]\n');
    });

    it("removes a secret and a browser-safe key sharing one string in browser code", () => {
      expectNoLeak([
        { path: "package.json", content: '{"dependencies":{"next":"16"}}' },
        { path: "components/X.tsx", content: `"use client";\nconst cfg = "${fake.google()}|${fake.openai()}";\n` },
      ]);
    });
  });

  describe("keys in comments and docs", () => {
    it("redacts a key in a comment between two template literals without inventing code", () => {
      const o = fake.openai();
      const { out, result } = expectNoLeak([
        { path: "server/c.js", content: "const a = `top`;\n// old key: " + o + "\nconst b = `bottom`;\n" },
      ]);
      expect(out.get("server/c.js")).toBe("const a = `top`;\n// old key: IHORAA_MOVED_TO_ENV_OPENAI_API_KEY\nconst b = `bottom`;\n");
      expect(result.findings[0].fixSummary).toMatch(/comment/i);
      expect(result.plan.manualSteps.some((m) => m.file === "server/c.js")).toBe(false);
    });

    it("redacts a quoted key inside a // or # comment", () => {
      const o = fake.openai();
      const { out } = expectNoLeak([
        { path: "server/d.ts", content: `// const key = "${o}";\nexport const x = 1;\n` },
        { path: "tool.py", content: `# api_key = "${o}"\nprint(1)\n` },
      ]);
      expect(out.get("server/d.ts")).toBe('// const key = "IHORAA_MOVED_TO_ENV_OPENAI_API_KEY";\nexport const x = 1;\n');
      expect(out.get("tool.py")).toBe('# api_key = "IHORAA_MOVED_TO_ENV_OPENAI_API_KEY"\nprint(1)\n');
    });

    it("does not mistake a URL for a comment", () => {
      const s = fake.stripeLive();
      const { out } = expectNoLeak([{ path: "server/u.js", content: `fetch("https://api.x.com/v1?key=${s}");\n` }]);
      expect(out.get("server/u.js")).toBe('fetch("https://api.x.com/v1?key=" + process.env.STRIPE_SECRET_KEY);\n');
    });

    it("rewrites a key inside a multi-line template literal", () => {
      const o = fake.openai();
      const { out } = expectNoLeak([{ path: "server/m.js", content: "const t = `\n  Bearer " + o + "\n`;\n" }]);
      expect(out.get("server/m.js")).toBe("const t = `\n  Bearer ${process.env.OPENAI_API_KEY}\n`;\n");
    });

    it("redacts keys in Markdown docs with no manual step", () => {
      const { out, result } = expectNoLeak([{ path: "README.md", content: `Use key ${fake.anthropic()} to test.\n` }]);
      expect(out.get("README.md")).toBe("Use key IHORAA_MOVED_TO_ENV_ANTHROPIC_API_KEY to test.\n");
      expect(result.plan.manualSteps.some((m) => m.file === "README.md")).toBe(false);
    });
  });

  describe("unquoted YAML values", () => {
    it("uses a GitHub secret in workflows, with a name GitHub allows", () => {
      const { out, result } = expectNoLeak([{ path: ".github/workflows/ci.yml", content: `env:\n  GH_TOKEN: ${fake.github()}\n` }]);
      expect(out.get(".github/workflows/ci.yml")).toBe("env:\n  GH_TOKEN: ${{ secrets.GH_TOKEN }}\n");
      expect(result.plan.manualSteps.map((m) => m.title)).toContain("Add GH_TOKEN to your GitHub repository secrets");
      // GitHub Actions can't read .env, so the key must not be written there.
      expect(out.get(".env") ?? "").not.toContain("GH_TOKEN");
    });

    it("uses ${VAR} in docker-compose files", () => {
      const s = fake.stripeLive();
      const { out } = expectNoLeak([{ path: "docker-compose.yml", content: `services:\n  api:\n    environment:\n      STRIPE_KEY: ${s}\n` }]);
      expect(out.get("docker-compose.yml")).toContain("STRIPE_KEY: ${STRIPE_SECRET_KEY}");
      expect(out.get(".env")).toContain(`STRIPE_SECRET_KEY=${s}`);
    });

    it("falls back to a placeholder for other YAML files", () => {
      const { out, result } = expectNoLeak([{ path: "config/app.yaml", content: `openai_key: ${fake.openai()}\n` }]);
      expect(out.get("config/app.yaml")).toBe("openai_key: IHORAA_MOVED_TO_ENV_OPENAI_API_KEY\n");
      expect(result.plan.manualSteps.map((m) => m.title)).toContain("Load OPENAI_API_KEY in config/app.yaml");
    });
  });
});
