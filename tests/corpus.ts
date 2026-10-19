// Labelled sample projects for the accuracy benchmark (tests/benchmark.test.ts).
// "secret" cases plant leaks that must be found. "clean" cases hold look-alikes
// that must not be reported. Values are generated at runtime, like tests/fakes.ts,
// so no realistic key literal is ever committed.

import type { SourceFile } from "../lib/types";
import { fake, randomChars } from "./fakes";

export interface CorpusCase {
  name: string;
  /** Groups cases on the scorecard. */
  category: string;
  kind: "secret" | "clean";
  files: SourceFile[];
  /** Planted secrets. Every one must be found; anything else reported is a false alarm. */
  secrets: string[];
}

const hex = (n: number) => randomChars(n, "0123456789abcdef");
const base64 = (n: number) => randomChars(n, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
const uuid = () => [hex(8), hex(4), "4" + hex(3), "a" + hex(3), hex(12)].join("-");
const b64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const NEXT_PKG: SourceFile = { path: "package.json", content: '{"dependencies":{"next":"16.0.0","react":"19.0.0"}}' };

const file = (path: string, ...lines: string[]): SourceFile => ({ path, content: lines.join("\n") + "\n" });

function leak(category: string, name: string, files: SourceFile[], secrets: string[]): CorpusCase {
  return { name, category, kind: "secret", files, secrets };
}

function clean(category: string, name: string, files: SourceFile[]): CorpusCase {
  return { name, category, kind: "clean", files, secrets: [] };
}

function secretCases(): CorpusCase[] {
  const openai = fake.openai();
  const anthropic = fake.anthropic();
  const stripe = fake.stripeLive();
  const awsId = fake.awsId();
  const awsSecret = fake.awsSecret();
  const github = fake.github();
  const supabase = fake.supabaseService();
  const dbUrl = fake.dbUrl();
  const google = fake.google();
  const paymentSecret = fake.generic();
  const django = "django-insecure-" + randomChars(50, "abcdefghijklmnopqrstuvwxyz0123456789!@%^&*(-_=+)");
  const session = randomChars(48);
  const weakPassword = "Summer" + "2024!";
  const pem = fake.privateKey();
  const exampleKey = fake.openai();
  const testFileKey = fake.stripeLive();
  const slack = fake.slack();
  const clientSecret = fake.generic();
  const readmeKey = fake.anthropic();
  const uuidKey = uuid();
  const hexToken = hex(40);
  const androidKey = fake.generic();
  const webhook = "https://hooks.slack.com/services/T" + randomChars(8, "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") + "/B" + randomChars(8, "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") + "/" + randomChars(24);
  const numericPassword = randomChars(8, "0123456789");
  const weakJwt = "super" + "secret";
  const latestSecret = fake.generic();
  const markerAboveSecret = fake.generic();
  const wordyPassword = "Correct" + "HorseBatteryStaple";
  const lettersOnly = randomChars(32, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
  const slackWebhook = fake.slackWebhook();
  const slackWebhookEnv = fake.slackWebhook();
  const discordWebhook = fake.discordWebhook();
  const discordAppWebhook = fake.discordWebhook().replace("discord.com", "discordapp.com");

  return [
    leak("provider key", "OpenAI key in a browser component", [
      NEXT_PKG,
      file(
        "app/chat/page.tsx",
        '"use client";',
        'import OpenAI from "openai";',
        `const openai = new OpenAI({ apiKey: "${openai}", dangerouslyAllowBrowser: true });`,
      ),
    ], [openai]),
    leak("provider key", "Anthropic key in an API route", [
      NEXT_PKG,
      file("app/api/chat/route.ts", 'import Anthropic from "@anthropic-ai/sdk";', `const client = new Anthropic({ apiKey: "${anthropic}" });`),
    ], [anthropic]),
    leak("provider key", "AWS key pair in Python settings", [
      file("settings.py", `AWS_ACCESS_KEY_ID = "${awsId}"`, `AWS_SECRET_ACCESS_KEY = "${awsSecret}"`),
    ], [awsId, awsSecret]),
    leak("provider key", "GitHub token in a CI workflow", [
      file(".github/workflows/deploy.yml", "jobs:", "  deploy:", "    env:", `      GH_TOKEN: ${github}`),
    ], [github]),
    leak("provider key", "Supabase service-role key in shared code", [
      file("lib/supabase.ts", 'import { createClient } from "@supabase/supabase-js";', `export const db = createClient("https://abc.supabase.co", "${supabase}");`),
    ], [supabase]),
    leak("provider key", "Database password in docker-compose", [
      file("docker-compose.yml", "services:", "  web:", "    environment:", `      DATABASE_URL: ${dbUrl}`),
    ], [dbUrl]),
    leak("provider key", "Google Maps key in a static page", [
      file("index.html", `<script src="https://maps.googleapis.com/maps/api/js?key=${google}"></script>`),
    ], [google]),
    leak("provider key", "Private key in a JS file", [file("config/signing.js", "export const key = `" + pem + "`;")], [pem]),
    leak("provider key", "Slack token in a Python script", [
      file("scripts/notify.py", "from slack_sdk import WebClient", `client = WebClient(token="${slack}")`),
    ], [slack]),
    // Webhook URLs end in URL, a name the generic check skips, so only the provider rules catch them.
    leak("provider key", "Slack webhook URL in server code", [
      file("server/alerts.js", `await fetch("${slackWebhook}", { method: "POST", body: JSON.stringify({ text }) });`),
    ], [slackWebhook]),
    leak("provider key", "Discord webhook URL in a Python bot", [
      file("bot/notify.py", "import requests", `DISCORD_WEBHOOK_URL = "${discordWebhook}"`, 'requests.post(DISCORD_WEBHOOK_URL, json={"content": msg})'),
    ], [discordWebhook]),
    leak(".env file", "Webhook URLs in a .env that is not gitignored", [
      file(".env", `SLACK_WEBHOOK_URL=${slackWebhookEnv}`, `DISCORD_WEBHOOK_URL=${discordAppWebhook}`),
    ], [slackWebhookEnv, discordAppWebhook]),
    leak("generic secret", "Random secret in server code", [file("server/payments.js", `const paymentSecret = "${paymentSecret}";`)], [paymentSecret]),
    leak("generic secret", "Django SECRET_KEY", [file("myapp/settings.py", `SECRET_KEY = "${django}"`, "DEBUG = False")], [django]),
    leak("generic secret", "Client secret in a JSON config", [
      file("config/oauth.json", "{", `  "clientId": "my-app-web",`, `  "clientSecret": "${clientSecret}"`, "}"),
    ], [clientSecret]),
    // Real keys can be hex or UUID shaped, so hash/ID skipping must go by name only.
    leak("generic secret", "UUID-shaped API key", [file("server/heroku.js", `const herokuApiKey = "${uuidKey}";`)], [uuidKey]),
    leak("generic secret", "Hex-only API token", [file("server/mailer.py", `MAILER_API_TOKEN = "${hexToken}"`)], [hexToken]),
    leak("generic secret", "Secret whose name ends in ANDROID", [
      file(".env", `MAPS_API_KEY_ANDROID=${androidKey}`),
    ], [androidKey]),
    // Word-like values are skipped, except under password names; random letters are not words.
    leak("generic secret", "Wordy password in code", [file("server/admin.js", `const adminPassword = "${wordyPassword}";`)], [wordyPassword]),
    leak("generic secret", "Random key made only of letters", [file("server/sign.js", `const signingSecret = "${lettersOnly}";`)], [lettersOnly]),
    leak(".env file", "Stripe key in a .env that is not gitignored", [
      file(".env", `STRIPE_SECRET_KEY=${stripe}`, "NEXT_PUBLIC_SITE_URL=https://myshop.io"),
      file(".gitignore", "node_modules"),
    ], [stripe]),
    leak(".env file", "Session secret in a .env that is not gitignored", [file(".env", `SESSION_SECRET=${session}`)], [session]),
    leak(".env file", "Weak admin password in a .env that is not gitignored", [file(".env", `ADMIN_PASSWORD=${weakPassword}`)], [weakPassword]),
    // Settings are skipped in .env files; these look like settings but are secrets.
    leak(".env file", "Numbers-only password in a .env", [file(".env", `ADMIN_PASSWORD=${numericPassword}`)], [numericPassword]),
    leak(".env file", "Plain-word JWT secret in a .env", [file(".env", `JWT_SECRET=${weakJwt}`)], [weakJwt]),
    leak(".env file", "Webhook URL with a token in its path", [file(".env", `ALERTS_WEBHOOK_TOKEN=${webhook}`)], [webhook]),
    leak(".env file", "Real key copied into .env.example", [
      file(".env.example", `OPENAI_API_KEY=${exampleKey}`),
      file(".gitignore", ".env*", "!.env.example"),
    ], [exampleKey]),
    leak("tests and docs", "Real provider key inside a test file", [
      file("tests/stripe.test.ts", 'import Stripe from "stripe";', `const stripe = new Stripe("${testFileKey}");`),
    ], [testFileKey]),
    // Test files are matched by folder or file-name pattern, not by "test" anywhere in the path.
    leak("tests and docs", "Generic secret in a file named like a test", [
      file("server/latest-prices.js", `const pricingApiSecret = "${latestSecret}";`),
    ], [latestSecret]),
    leak("tests and docs", "Not-a-secret marker on a different line", [
      file("server/billing.js", "// ihoraa-ignore", `const billingSecret = "${markerAboveSecret}";`),
    ], [markerAboveSecret]),
    leak("tests and docs", "Real key pasted into the README", [
      file("README.md", "## Setup", "", `Set \`ANTHROPIC_API_KEY=${readmeKey}\` and run \`npm run dev\`.`),
    ], [readmeKey]),
  ];
}

function cleanCases(): CorpusCase[] {
  const jwtSample = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ sub: "1234567890", name: "John Doe", iat: 1516239022 }),
    randomChars(43),
  ].join(".");

  return [
    clean("hashes and IDs", "Hashes with secret-sounding names", [
      file(
        "server/auth.js",
        `const passwordHash = "${hex(64)}"; // sha256 of the default password`,
        `const tokenChecksum = "${hex(40)}";`,
        `const secretDigest = "${hex(32)}";`,
      ),
    ]),
    clean("hashes and IDs", "IDs with key-sounding names", [
      file("server/keys.ts", `const apiKeyId = "${uuid()}";`, `const tokenId = "${uuid()}";`, `const secretKeyRef = "${uuid()}";`),
    ]),
    clean("hashes and IDs", "Git commit and build hashes", [
      file("lib/version.ts", `export const BUILD_SHA = "${hex(40)}";`, `export const buildId = "${randomChars(21)}";`),
    ]),
    clean("hashes and IDs", "Subresource integrity hashes", [
      file(
        "index.html",
        `<script src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js" integrity="sha384-${base64(64)}" crossorigin="anonymous"></script>`,
      ),
    ]),
    clean("encoded data", "Image data URI", [
      file("components/Badge.tsx", `const secretBadgeIcon = "data:image/png;base64,${base64(160)}";`),
    ]),
    clean("encoded data", "Supabase anon key in the browser", [
      NEXT_PKG,
      file(
        "components/supabase.ts",
        '"use client";',
        `const supabaseAnonKey = "${fake.supabaseAnon()}";`,
        `export const db = createClient("https://abc.supabase.co", "${fake.supabaseAnon()}");`,
      ),
    ]),
    clean("encoded data", "Publishable and public keys", [
      file(
        "components/checkout.ts",
        `const stripePublishableKey = "pk_live_${randomChars(40)}";`,
        `const vapidPublicKey = "${randomChars(87)}";`,
        `loadStripe("pk_live_${randomChars(40)}");`,
      ),
    ]),
    clean("references", "Env lookups instead of values", [
      file(
        "server/config.ts",
        "const apiKey = process.env.OPENAI_API_KEY;",
        "const token = import.meta.env.VITE_TOKEN;",
        'const password = process.env["DB_PASSWORD"] ?? "";',
      ),
      file("app.py", 'SECRET_KEY = os.environ["SECRET_KEY"]', 'API_TOKEN = os.getenv("API_TOKEN")'),
    ]),
    clean("references", "Cloud secret-manager references", [
      file(
        "server/secrets.ts",
        'const dbPasswordSecret = "projects/acme-prod-381203/secrets/db-password/versions/7";',
        'const apiKeySecretArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/api-key-AbCdEf";',
      ),
    ]),
    clean(".env settings", "Settings in a .env that is not gitignored", [
      file(
        ".env",
        "NODE_ENV=production",
        "TOKEN_EXPIRY=3600000s",
        "SESSION_TOKEN_TTL=86400000",
        "API_KEY_HEADER=Authorization",
        "PASSWORD_HASH_ALGO=argon2id",
        "TOKEN_ISSUER=https://auth.myapp.io",
        "AUTH_SECRET_ROTATION=disabled",
        "AUTH_TOKEN_REFRESH=true",
      ),
    ]),
    clean(".env settings", "Real key safely in a gitignored .env", [
      file(".env", `OPENAI_API_KEY=${fake.openai()}`),
      file(".gitignore", "node_modules", ".env"),
    ]),
    clean("tests and docs", "Generic values in test mocks", [
      file("tests/auth.test.ts", `const mockToken = "${randomChars(32)}";`, `const fakeApiKey = "${randomChars(40)}";`, `const token = "${jwtSample}";`),
      file("__mocks__/stripe.js", `export const secretKey = "${randomChars(32)}";`),
    ]),
    clean("tests and docs", "Values marked as not secret", [
      file("lib/demo.ts", `const demoToken = "${randomChars(32)}"; // ihoraa-ignore`, `const sampleApiKey = "${randomChars(40)}"; // gitleaks:allow`),
    ]),
    clean("tests and docs", "Placeholders in setup docs", [
      file(
        "README.md",
        "## Environment",
        "```",
        "OPENAI_API_KEY=sk-...",
        "STRIPE_SECRET_KEY=your_stripe_secret_key",
        "GITHUB_TOKEN=<YOUR_TOKEN>",
        "```",
      ),
    ]),
    clean("ordinary code", "Translation strings", [
      file(
        "locales/en.json",
        '{"auth": {"passwordTooShort": "Password must be at least 8 characters", "tokenExpired": "Your session has expired, please sign in again"}}',
      ),
    ]),
    clean("ordinary code", "Class names and paths", [
      file(
        "components/Login.tsx",
        'const tokenInputClass = "rounded-lg border border-gray-300 focus:ring-2";',
        'const secretsDir = "./config/secrets";',
        'const tokenEndpoint = "/oauth2/v1/token/refresh";',
      ),
    ]),
    // Found by scanning real open-source code (node_modules) during the T8 review.
    clean("ordinary code", "Word-like identifiers under token names", [
      file(
        "lib/lexer.js",
        'nextLastSignificantToken = "?NonExpressionParenEnd";',
        'const messages = {UnexpectedToken:"Unexpected token =",DuplicateBinding:"Duplicate binding"};',
      ),
    ]),
    clean("ordinary code", "Minified code between two quotes", [
      file("public/bundle.js", 'if(r)e.credentials="+A)}s=makeRequest({urlList:[t]});n="omit";'),
    ]),
    clean("tests and docs", "Placeholder webhook URLs in docs and config", [
      file(
        "README.md",
        "Create an incoming webhook (https://api.slack.com/messaging/webhooks) and set:",
        "```",
        "SLACK_WEBHOOK_URL=https://hooks." + "slack.com/services/T00000000/B00000000/" + "X".repeat(24),
        "DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/{webhook.id}/{webhook.token}",
        "```",
      ),
      file("server/config.js", `const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? "https://hooks.` + `slack.com/services/T00000000/B00000000/${"X".repeat(24)}";`),
    ]),
    clean("tests and docs", "Example database URLs in docs", [
      file("README.md", "Connect with `mongodb://username:password@host:1234/app` or `postgres://user:pass@db.myapp.io:5432/app`."),
    ]),
    clean("tests and docs", "Docs example key with mismatched BEGIN and END", [
      file("docs/env.md", "PRIVATE_KEY=\"-----BEGIN RSA PRIVATE KEY-----", randomChars(64), "-----END DSA PRIVATE KEY-----\""),
    ]),
    clean("ordinary code", "Small app with no secrets", [
      NEXT_PKG,
      file(".gitignore", "node_modules", ".env*"),
      file("app/page.tsx", 'import { getPosts } from "@/lib/api";', "export default async function Home() {", "  const posts = await getPosts();", "  return <main>{posts.length} posts</main>;", "}"),
      file(
        "lib/api.ts",
        "export async function getPosts() {",
        '  const res = await fetch("https://api.myblog.io/posts", { headers: { Authorization: `Bearer ${process.env.BLOG_API_TOKEN}` } });',
        "  return res.json();",
        "}",
      ),
    ]),
  ];
}

export function buildCorpus(): CorpusCase[] {
  return [...secretCases(), ...cleanCases()];
}
