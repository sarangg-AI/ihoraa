import type { Project } from "./project";

// A small "vibe-coded" Next.js app with typical leaks, so people can try Ihoraa
// without uploading their own code. Keys are random and assembled at runtime,
// so they are not real and no realistic-looking key is stored in this repo.

function rand(length: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

const b64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function demoProject(): Project {
  const openai = ["sk", "proj", rand(64)].join("-");
  const stripe = ["sk", "live", rand(48)].join("_");
  const google = "AI" + "za" + rand(35);
  const github = "gh" + "p_" + rand(36);
  const service = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ iss: "supabase", ref: rand(20).toLowerCase(), role: "service_role" }), rand(43)].join(".");
  const dbUrl = "postgres" + `ql://postgres.${rand(12).toLowerCase()}:${rand(20)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: "ai-study-buddy",
        private: true,
        scripts: { dev: "next dev", build: "next build" },
        dependencies: { next: "16.0.0", react: "19.0.0", openai: "5.0.0", stripe: "18.0.0", "@supabase/supabase-js": "2.50.0" },
      },
      null,
      2,
    ),
    ".gitignore": "node_modules\n.next\n",
    ".env": `DATABASE_URL=${dbUrl}\n`,
    "app/page.tsx": `import ChatBox from "@/components/ChatBox";
import MapView from "@/components/MapView";

export default function Home() {
  return (
    <main className="p-8">
      <h1>AI Study Buddy</h1>
      <ChatBox />
      <MapView />
    </main>
  );
}
`,
    "components/ChatBox.tsx": `"use client";

import { useState } from "react";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "${openai}",
  dangerouslyAllowBrowser: true,
});

export default function ChatBox() {
  const [answer, setAnswer] = useState("");

  async function ask(question: string) {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });
    setAnswer(res.choices[0].message.content ?? "");
  }

  return <div onClick={() => ask("Explain photosynthesis")}>{answer || "Ask me anything"}</div>;
}
`,
    "components/MapView.tsx": `"use client";

export default function MapView() {
  const src = \`https://maps.googleapis.com/maps/api/staticmap?center=Paris&zoom=12&size=600x300&key=${google}\`;
  return <img src={src} alt="Study spots near you" />;
}
`,
    "app/api/checkout/route.ts": `import Stripe from "stripe";

const stripe = new Stripe("${stripe}");

export async function POST() {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: "price_123", quantity: 1 }],
    success_url: "https://example.com/success",
  });
  return Response.json({ url: session.url });
}
`,
    "lib/supabaseAdmin.ts": `import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  "https://abcdefghijklmnop.supabase.co",
  "${service}",
);
`,
    "scripts/backup.py": `import requests

GITHUB_TOKEN = "${github}"

def backup():
    headers = {"Authorization": f"token {GITHUB_TOKEN}"}
    return requests.get("https://api.github.com/user/repos", headers=headers).json()
`,
    "README.md": "# AI Study Buddy\n\nBuilt with Next.js, OpenAI, Stripe and Supabase.\n",
  };

  return {
    name: "ai-study-buddy",
    entries: Object.entries(files).map(([path, text]) => ({ path, size: text.length, text, read: async () => text })),
  };
}
