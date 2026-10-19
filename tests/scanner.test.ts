import { describe, expect, it } from "vitest";
import { analyze } from "../lib/analyze";
import { isGitIgnored, scanFiles, securityScore } from "../lib/scanner";
import { classifyExposure } from "../lib/scanner/exposure";
import { maskSecret } from "../lib/scanner/mask";
import { fake } from "./fakes";

const scanOne = (path: string, content: string, extra: { path: string; content: string }[] = []) =>
  scanFiles([{ path, content }, ...extra]).findings;

describe("provider rules", () => {
  const cases: [string, () => string][] = [
    ["openai-api-key", fake.openai],
    ["anthropic-api-key", fake.anthropic],
    ["stripe-secret-key", fake.stripeLive],
    ["aws-access-key-id", fake.awsId],
    ["google-api-key", fake.google],
    ["github-token", fake.github],
    ["supabase-service-role", fake.supabaseService],
    ["database-url", fake.dbUrl],
    ["stripe-test-key", fake.stripeTest],
    ["supabase-secret-key", fake.supabaseSecret],
    ["slack-token", fake.slack],
    ["slack-webhook-url", fake.slackWebhook],
    ["discord-webhook-url", fake.discordWebhook],
    ["sendgrid-api-key", fake.sendgrid],
    ["twilio-api-key", fake.twilio],
    ["mailgun-api-key", fake.mailgun],
    ["huggingface-token", fake.huggingface],
    ["groq-api-key", fake.groq],
    ["replicate-api-token", fake.replicate],
  ];

  for (const [ruleId, make] of cases) {
    it(`detects ${ruleId}`, () => {
      const secret = make();
      const findings = scanOne("server/index.js", `const client = createClient("${secret}");\n`);
      expect(findings.map((f) => f.ruleId)).toContain(ruleId);
      const f = findings.find((x) => x.ruleId === ruleId)!;
      expect(f.secret).toBe(secret);
      expect(f.line).toBe(1);
    });
  }

  it("does not flag the Supabase anon key", () => {
    expect(scanOne("server/db.js", `const anon = "${fake.supabaseAnon()}";`)).toHaveLength(0);
  });

  it("detects a private key block", () => {
    const pem = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEow" + "IBAAKCAQEA" + "Zk9vT2Q3ZXlQ", "-----END RSA PRIVATE KEY-----"].join("\n");
    const findings = scanOne("server/sign.js", "const key = `" + pem + "`;");
    expect(findings[0]?.ruleId).toBe("private-key");
  });

  it("ignores placeholders", () => {
    const content = [
      'const OPENAI_API_KEY = "sk-proj-your-api-key-here-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";',
      'const apiKey = "<YOUR_API_KEY>";',
      "const token = process.env.TOKEN;",
      'const secret = "changeme";',
    ].join("\n");
    expect(scanOne("server/a.js", content)).toHaveLength(0);
  });

  it("ignores a localhost database URL", () => {
    expect(scanOne("server/db.js", 'const url = "postgres://postgres:postgres@localhost:5432/app";')).toHaveLength(0);
  });

  it("detects an AWS secret key only next to an AWS-style name", () => {
    const secret = fake.awsSecret();
    const quoted = scanOne("server/s3.js", `const aws_secret_access_key = "${secret}";`);
    expect(quoted.map((f) => f.ruleId)).toEqual(["aws-secret-access-key"]);
    expect(quoted[0].secret).toBe(secret);
    const env = scanOne(".env", `AWS_SECRET_ACCESS_KEY=${secret}\n`);
    expect(env.map((f) => f.ruleId)).toEqual(["aws-secret-access-key"]);
    expect(scanOne("server/s3.js", `const checksum = "${secret}";`).some((f) => f.ruleId === "aws-secret-access-key")).toBe(false);
  });

  it("rates Stripe test keys lower than live keys", () => {
    expect(scanOne("server/a.js", `k("${fake.stripeTest()}")`)[0].severity).toBe("medium");
    expect(scanOne("server/a.js", `k("${fake.stripeLive()}")`)[0].severity).toBe("critical");
  });

  it("does not flag look-alikes of the loose patterns", () => {
    const content = [
      // "key-" inside a longer word is not a Mailgun key.
      `const id = "monkey-${"a1".repeat(16)}";`,
      // One hex digit short of a Twilio key.
      `const sku = "${"S" + "K" + "ab12".repeat(7) + "abc"}";`,
      // Supabase publishable keys are meant for browsers.
      `const pub = "sb_publishable_${"x9".repeat(16)}";`,
      // A Slack-looking prefix with too little after it.
      'const s = "xoxb-123";',
    ].join("\n");
    expect(scanOne("server/look.js", content)).toEqual([]);
  });
});

describe("generic secrets", () => {
  it("flags a random value assigned to a secret-looking name", () => {
    const findings = scanOne("server/pay.js", `const paymentSecret = "${fake.generic()}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("generic-secret");
    expect(findings[0].envName).toBe("PAYMENT_SECRET");
  });

  it("ignores low-entropy and non-secret names", () => {
    const content = ['const tokenizer = "aaaaaaaaaaaaaaaaaaaaaa";', `const userId = "${fake.generic()}";`].join("\n");
    expect(scanOne("server/x.js", content)).toHaveLength(0);
  });
});

describe("exposure", () => {
  it("treats 'use client' files as frontend and escalates severity", () => {
    const secret = fake.google();
    const f = scanOne("app/map.tsx", `"use client";\nconst KEY = "${secret}";`)[0];
    expect(f.exposure).toBe("frontend");
    // Google keys are public by design, so they stay medium even in the browser.
    expect(f.severity).toBe("medium");

    const openai = scanOne("app/chat.tsx", `"use client";\nconst KEY = "${fake.openai()}";`)[0];
    expect(openai.exposure).toBe("frontend");
    expect(openai.severity).toBe("critical");
  });

  it("classifies by framework and path", () => {
    const pkgNext = '{"dependencies":{"next":"16.0.0"}}';
    const f = (path: string, content = "") => ({ path, content });
    expect(classifyExposure(f("app/page.tsx"), "next")).toBe("server");
    expect(classifyExposure(f("components/Chat.tsx"), "next")).toBe("frontend");
    expect(classifyExposure(f("pages/index.tsx"), "next")).toBe("frontend");
    expect(classifyExposure(f("pages/api/chat.ts"), "next")).toBe("server");
    expect(classifyExposure(f("src/App.tsx"), "vite")).toBe("frontend");
    expect(classifyExposure(f("main.py"), "python")).toBe("server");
    expect(classifyExposure(f("index.html"), "static")).toBe("frontend");
    expect(pkgNext).toContain("next");
  });
});

describe(".env files", () => {
  it("skips secrets in a gitignored .env", () => {
    const env = `OPENAI_API_KEY=${fake.openai()}\n`;
    expect(scanOne(".env", env, [{ path: ".gitignore", content: "node_modules\n.env*\n" }])).toHaveLength(0);
  });

  it("flags secrets in a .env that is not gitignored", () => {
    const env = `OPENAI_API_KEY=${fake.openai()}\nDB_PASSWORD=${fake.generic()}\n`;
    const findings = scanOne(".env", env);
    expect(findings.map((f) => f.exposure)).toEqual(["env-file", "env-file"]);
    expect(findings.map((f) => f.envName).sort()).toEqual(["DB_PASSWORD", "OPENAI_API_KEY"]);
  });

  it("flags secrets in public env variables even when gitignored", () => {
    const env = `NEXT_PUBLIC_OPENAI_KEY=${fake.openai()}\n`;
    const findings = scanOne(".env.local", env, [{ path: ".gitignore", content: ".env*" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].exposure).toBe("frontend");
    expect(findings[0].severity).toBe("critical");
  });

  it("reuses the .env variable name for the same secret in code", () => {
    const secret = fake.stripeLive();
    const findings = scanOne("server/pay.js", `const stripe = new Stripe("${secret}");`, [
      { path: ".env", content: `MY_STRIPE=${secret}` },
      { path: ".gitignore", content: ".env" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].envName).toBe("MY_STRIPE");
  });
});

describe("confidence", () => {
  it("is high for provider formats and medium for generic matches", () => {
    const scan = scanFiles([
      { path: "server/a.js", content: `k("${fake.stripeLive()}");\nconst paymentSecret = "${fake.generic()}";\n` },
      { path: ".env", content: `SESSION_SECRET=${fake.generic()}\n` },
    ]);
    const byRule = Object.fromEntries(scan.findings.map((f) => [f.ruleId, f.confidence]));
    expect(byRule).toEqual({ "stripe-secret-key": "high", "generic-secret": "medium", "env-file-secret": "medium" });
  });
});

describe("not-a-secret markers", () => {
  it("skips a match marked ihoraa-ignore or gitleaks:allow and reports where", () => {
    const scan = scanFiles([
      { path: "server/a.js", content: `const demoSecret = "${fake.generic()}"; // ihoraa-ignore\n` },
      { path: ".env", content: `STRIPE_SECRET_KEY=${fake.stripeLive()} # gitleaks:allow\n` },
    ]);
    expect(scan.findings).toHaveLength(0);
    expect(scan.ignored).toEqual([
      { file: ".env", line: 1 },
      { file: "server/a.js", line: 1 },
    ]);
  });

  it("only hides the line the marker is on", () => {
    const scan = scanFiles([
      { path: "server/a.js", content: `// ihoraa-ignore\nconst paymentSecret = "${fake.generic()}";\n` },
    ]);
    expect(scan.findings).toHaveLength(1);
    expect(scan.ignored).toHaveLength(0);
  });

  it("never sends the ignored value to the browser", () => {
    const secret = fake.openai();
    const { result } = analyze({ projectName: "p", files: [{ path: "server/a.js", content: `k("${secret}"); // ihoraa-ignore\n` }] });
    expect(result.ignored).toEqual([{ file: "server/a.js", line: 1 }]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("helpers", () => {
  it("matches gitignore patterns", () => {
    expect(isGitIgnored(".env", ".env")).toBe(true);
    expect(isGitIgnored(".env*\n!.env.example", ".env.example")).toBe(false);
    expect(isGitIgnored(".env.local", ".env")).toBe(false);
    expect(isGitIgnored("*.env", "prod.env")).toBe(true);
  });

  it("masks secrets keeping only a recognisable prefix and suffix", () => {
    const secret = fake.openai();
    const masked = maskSecret(secret);
    expect(masked.startsWith("sk-proj-")).toBe(true);
    expect(masked.endsWith(secret.slice(-4))).toBe(true);
    expect(masked).not.toContain(secret.slice(8, 20));
  });

  it("masks webhook URLs keeping the host and hiding the token", () => {
    const slack = fake.slackWebhook();
    expect(maskSecret(slack)).toMatch(/^https:\/\/hooks\.slack\.com\/services\/•+.{4}$/);
    const discord = fake.discordWebhook();
    expect(maskSecret(discord)).toMatch(/^https:\/\/discord\.com\/api\/webhooks\/•+.{4}$/);
    expect(maskSecret(discord)).not.toContain(discord.split("/")[6].slice(0, 20));
  });

  it("never leaves the secret in snippets", () => {
    const secret = fake.openai();
    const f = scanOne("server/a.js", `// setup\nconst k = "${secret}";\n`)[0];
    expect(JSON.stringify(f.snippet)).not.toContain(secret);
    expect(f.snippet.find((s) => s.highlight)?.line).toBe(2);
  });

  it("scores by unique secret and severity", () => {
    const secret = fake.openai();
    const findings = scanOne("server/a.js", `a("${secret}"); b("${secret}");`);
    expect(findings).toHaveLength(2);
    expect(securityScore(findings)).toBe(70);
    expect(securityScore([])).toBe(100);
  });
});
