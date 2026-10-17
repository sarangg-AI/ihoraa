import type { ManualStep, RawFinding, Rotation } from "../types";

const EXPOSURE_LABEL: Record<RawFinding["exposure"], string> = {
  frontend: "Visible in the browser",
  server: "Server code",
  "env-file": "Unprotected .env file",
  config: "Config or docs file",
};

/** A plain-English Markdown report that ships inside the secured zip. No raw secrets. */
export function buildReport(input: {
  projectName: string;
  findings: RawFinding[];
  manual: ManualStep[];
  rotations: Rotation[];
  changed: string[];
}): string {
  const { projectName, findings, manual, rotations, changed } = input;
  const date = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push(`# Ihoraa security report: ${projectName}`, "", `Scanned on ${date}. Found ${findings.length} exposed secret${findings.length === 1 ? "" : "s"}.`, "");

  out.push("## 1. Rotate your keys (most important)", "");
  out.push(
    "Moving a key out of your code stops future leaks, but anyone who already saw the old key can still use it. Create a new key for each service below and delete the old one.",
    "",
  );
  for (const r of rotations) {
    out.push(`- [ ] **${r.provider}** (\`${r.envName}\`, old key \`${r.masked}\`)${r.rotateUrl ? `: ${r.rotateUrl}` : ""}`);
    for (const s of r.steps) out.push(`  - ${s}`);
  }
  out.push("");

  if (manual.length) {
    out.push("## 2. Finish these steps", "");
    manual.forEach((m, i) => {
      out.push(`### ${i + 1}. ${m.title}`, "", m.detail, "");
      if (m.aiPrompt) out.push("Paste this into your AI coding tool:", "", "```text", m.aiPrompt, "```", "");
    });
  }

  out.push("## 3. What Ihoraa found and fixed", "");
  out.push("| Severity | Service | Where | Exposure | Fix |", "| --- | --- | --- | --- | --- |");
  for (const f of findings) {
    out.push(`| ${f.severity} | ${f.provider} | \`${f.file}:${f.line}\` | ${EXPOSURE_LABEL[f.exposure]} | ${f.fixSummary.replace(/\|/g, "\\|")} |`);
  }
  out.push("");

  out.push("## 4. Files changed", "");
  for (const c of changed) out.push(`- \`${c}\``);
  out.push(
    "",
    "## How to use the secured project",
    "",
    "Copy the files from this zip over your project folder (replace when asked). Your `node_modules` and git history are not included, so copying over keeps them intact.",
    "",
    "Your `.env` file now holds your keys. Never upload it, share it or paste it into chats. `.gitignore` already keeps it out of GitHub.",
    "",
  );
  return out.join("\n");
}
