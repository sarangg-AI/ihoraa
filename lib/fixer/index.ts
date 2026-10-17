import type { FileChange, FixPlan, ManualStep, RawFinding, Rotation, SourceFile } from "../types";
import type { ScanOutput } from "../scanner";
import { isEnvFile, isPublicEnvName } from "../scanner/exposure";
import { buildChange } from "./diff";
import { parseEnv, updateDotEnv, updateEnvExample, updateGitignore } from "./envfiles";
import { envExpression, languageOf, lineComment, publicPrefix, type Lang } from "./language";
import { applyEdits, editsOverlap, replaceWithExpression, type Edit } from "./literal";
import { PROXY_PROVIDERS, proxyRoute, proxySource } from "./proxy";
import { buildReport } from "./report";

export const MOVED_TO_SERVER = "IHORAA_KEY_MOVED_TO_SERVER";
export const REPORT_PATH = "IHORAA_REPORT.md";

export interface FixOutput {
  /** Full contents of every file that is new or changed. Contains real secrets in `.env`. */
  files: SourceFile[];
  plan: FixPlan;
  findings: RawFinding[];
}

const WORKFLOW = /^\.github\/workflows\//;

function addPythonImport(content: string): string {
  if (/^\s*import\s+os\b|^\s*import\s+[\w ,]*\bos\b|^\s*from\s+os\s+import/m.test(content)) return content;
  const lines = content.split("\n");
  let at = 0;
  while (at < lines.length && (/^#!|^#.*coding[:=]/.test(lines[at]) || /^from __future__ import/.test(lines[at]))) at++;
  lines.splice(at, 0, "import os");
  return lines.join("\n");
}

function aiPromptForFrontend(f: RawFinding, proxy?: { url: string; path: string; examplePath: string }): string {
  if (proxy) {
    return [
      `In ${f.file}, my code called ${f.provider} directly from the browser with an API key.`,
      `Ihoraa removed the key (it now says ${MOVED_TO_SERVER}) and added a server route at ${proxy.path}.`,
      `Update ${f.file} so it sends its ${f.provider} requests to POST ${proxy.url} with the JSON body`,
      `{ "path": "${proxy.examplePath}", "body": <the same request body as before> } instead of calling ${f.provider} directly.`,
      `Remove the ${f.provider} SDK and any "dangerouslyAllowBrowser" option from browser code.`,
      `Never put the API key back in browser code.`,
    ].join(" ");
  }
  return [
    `In ${f.file}, browser code uses a secret ${f.provider} key. Ihoraa removed it (it now says ${MOVED_TO_SERVER}).`,
    `Move the code that needs this key into a server-side API route that reads it from the environment variable ${f.envName},`,
    `and make the browser call that route instead. Never put the key back in browser code.`,
  ].join(" ");
}

export function buildFix(scan: ScanOutput, projectName: string): FixOutput {
  const { files, framework } = scan;
  if (scan.findings.length === 0) {
    return { files: [], plan: { changes: [], manualSteps: [], rotations: [] }, findings: [] };
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  const secrets = [...new Set(scan.findings.map((f) => f.secret))];
  const findings = scan.findings.map((f) => ({ ...f }));

  const edits = new Map<string, Edit[]>();
  const needsPythonOs = new Set<string>();
  const envVars = new Map<string, string>(); // name -> value for .env
  const manual: ManualStep[] = [];
  const proxies = new Map<string, { path: string; url: string; envName: string; examplePath: string }>();
  const added: SourceFile[] = [];
  const pushEdit = (path: string, edit: Edit): boolean => {
    const list = edits.get(path) ?? [];
    if (list.some((e) => editsOverlap(e, edit))) return false;
    list.push(edit);
    edits.set(path, list);
    return true;
  };
  const todoLines = new Map<string, Set<number>>();

  for (const f of findings) {
    const file = byPath.get(f.file)!;
    const lang: Lang = languageOf(f.file);

    // 1. Secrets that already live in a .env file.
    if (isEnvFile(f.file)) {
      const varName = [...parseEnv(file.content)].find(([, v]) => v === f.secret)?.[0];
      if (f.exposure === "frontend" && varName && isPublicEnvName(varName)) {
        f.fixSummary = `Rename ${varName} so it stops being bundled into your website, then use it only on the server.`;
        manual.push({
          id: `rename-${f.id}`,
          title: `Stop sending ${varName} to the browser`,
          file: f.file,
          detail: `Variables starting with ${varName.split("_")[0]}_ are copied into your website's code where anyone can read them. Rename it without the prefix and only use it in server code.`,
          aiPrompt: `My env variable ${varName} holds a secret ${f.provider} key, but its prefix makes it public in the browser bundle. Rename it to ${varName.replace(/^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/, "")} in every .env file, move every piece of code that uses it into a server-side API route, and make the browser call that route instead.`,
        });
      } else {
        f.fixSummary = "Keep it in .env, which Ihoraa now adds to .gitignore so it never gets uploaded.";
      }
      continue;
    }

    const isFrontendSecret = f.exposure === "frontend" && !f.publicByDesign;

    // 2. Secret keys in browser code: remove them. They cannot be hidden there.
    if (isFrontendSecret) {
      pushEdit(f.file, { start: f.start, end: f.end, text: MOVED_TO_SERVER });
      envVars.set(f.envName, f.secret);
      const provider = PROXY_PROVIDERS[f.provider];
      let proxyInfo: { url: string; path: string; examplePath: string } | undefined;
      if (provider) {
        let proxy = proxies.get(provider.slug);
        if (!proxy) {
          const route = proxyRoute(framework, files, provider.slug);
          proxy = { ...route, envName: f.envName, examplePath: provider.examplePath };
          proxies.set(provider.slug, proxy);
          if (!byPath.has(route.path)) added.push({ path: route.path, content: proxySource(route.path, provider, f.envName) });
        }
        proxyInfo = proxy;
      }
      const comment = lineComment(lang);
      const seen = todoLines.get(f.file) ?? new Set<number>();
      if (comment && !seen.has(f.line)) {
        const lineStart = file.content.lastIndexOf("\n", f.start - 1) + 1;
        const lineEnd = file.content.indexOf("\n", lineStart);
        const lineText = file.content.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        // In JSX/HTML markup a comment line would render as text, so skip it there.
        if (!/^\s*</.test(lineText) && !/\.(vue|svelte|astro)$/.test(f.file)) {
          const indent = /^\s*/.exec(lineText)?.[0] ?? "";
          pushEdit(f.file, {
            start: lineStart,
            end: lineStart,
            text: `${indent}${comment} TODO(ihoraa): secret key removed from browser code. See ${REPORT_PATH}.\n`,
          });
        }
        seen.add(f.line);
        todoLines.set(f.file, seen);
      }
      f.fixSummary = provider
        ? `Removed from browser code. Your app now talks to ${f.provider} through a private server route.`
        : "Removed from browser code. The feature using it must move to a server route (see the manual step).";
      manual.push({
        id: `frontend-${f.id}`,
        title: provider ? `Point ${f.file} at the new ${f.provider} server route` : `Move the ${f.provider} code in ${f.file} to your server`,
        file: f.file,
        detail: provider
          ? `Ihoraa created ${proxyInfo!.path}, which calls ${f.provider} with your key on the server. Your browser code needs a small change to use it. Copy the prompt into your AI coding tool.`
          : `A ${f.provider} secret key can never be safe in a website, because visitors can read all of its code. The code that uses it has to run on a server. Copy the prompt into your AI coding tool.`,
        aiPrompt: aiPromptForFrontend(f, proxyInfo),
      });
      continue;
    }

    // 3. Everything else: swap the literal for an env lookup.
    let envName = f.envName;
    if (f.exposure === "frontend" && f.publicByDesign) {
      const prefix = publicPrefix(framework);
      if (prefix && !envName.startsWith(prefix)) envName = prefix + envName;
    }

    let expr = envExpression(lang, envName, { exposure: f.exposure, framework });
    if (lang === "yaml" && WORKFLOW.test(f.file)) expr = `\${{ secrets.${envName} }}`;
    const canRead = expr && !(f.exposure === "frontend" && f.publicByDesign && !publicPrefix(framework));
    const edit = canRead ? replaceWithExpression(file.content, f, expr!, lang, f.file) : null;

    if (edit && pushEdit(f.file, edit)) {
      if (lang === "py") needsPythonOs.add(f.file);
      if (!WORKFLOW.test(f.file)) envVars.set(envName, f.secret);
      f.envName = envName;
      f.fixSummary = `Moved to .env as ${envName}. The code now reads it from there.`;
      if (WORKFLOW.test(f.file)) {
        f.fixSummary = `Replaced with the GitHub secret ${envName}.`;
        manual.push({
          id: `gh-secret-${f.id}`,
          title: `Add ${envName} to your GitHub repository secrets`,
          file: f.file,
          detail: `In GitHub, open your repository → Settings → Secrets and variables → Actions → New repository secret, and add ${envName} with a newly rotated key.`,
        });
      }
      continue;
    }

    if (f.exposure === "frontend" && f.publicByDesign) {
      f.fixSummary = "Left in place: this key type is meant to be public. Lock it to your domain instead.";
      continue;
    }

    // No safe automatic rewrite: redact it and explain.
    const placeholder = `IHORAA_MOVED_TO_ENV_${f.envName}`;
    pushEdit(f.file, { start: f.start, end: f.end, text: placeholder });
    envVars.set(f.envName, f.secret);
    f.fixSummary = `Removed and saved to .env as ${f.envName}. This file can't read .env by itself, so it needs one manual step.`;
    manual.push({
      id: `manual-${f.id}`,
      title: `Load ${f.envName} in ${f.file}`,
      file: f.file,
      detail: `Ihoraa replaced the key with ${placeholder}. Change this file so it reads the value from the ${f.envName} environment variable.`,
      aiPrompt: `In ${f.file}, replace ${placeholder} with code that reads the ${f.envName} environment variable at runtime. Do not paste the real key into the file.`,
    });
  }

  // Build the new file contents.
  const changed = new Map<string, string>();
  for (const [path, list] of edits) {
    let content = applyEdits(byPath.get(path)!.content, list);
    if (needsPythonOs.has(path)) content = addPythonImport(content);
    changed.set(path, content);
  }

  const envPaths = files.filter((f) => isEnvFile(f.path)).map((f) => f.path);
  const dotenv = updateDotEnv(byPath.get(".env")?.content, envVars);
  if (dotenv !== null) changed.set(".env", dotenv);
  const example = updateEnvExample(byPath.get(".env.example")?.content, [...envVars.keys()]);
  if (example !== null) changed.set(".env.example", example);
  const gitignore = updateGitignore(byPath.get(".gitignore")?.content, envPaths);
  if (gitignore !== null) changed.set(".gitignore", gitignore);
  for (const a of added) changed.set(a.path, a.content);

  // Framework-specific notes on loading .env.
  if (envVars.size > 0) {
    if (framework === "node") {
      manual.push({
        id: "load-env-node",
        title: "Make sure your server loads .env",
        detail: "Plain Node.js does not read .env automatically. Start it with `node --env-file=.env server.js`, or add the dotenv package.",
        aiPrompt: "Make my Node.js server load environment variables from the .env file at startup (use node --env-file or the dotenv package).",
      });
    }
    if (files.some((f) => f.path.endsWith(".py"))) {
      manual.push({
        id: "load-env-python",
        title: "Load .env in your Python app",
        detail: "Python does not read .env automatically. Install python-dotenv and call load_dotenv() when your app starts.",
        aiPrompt: "Add python-dotenv to my Python project and call load_dotenv() at startup so os.environ reads the values in .env.",
      });
    }
  }

  if (scan.findings.some((f) => isEnvFile(f.file))) {
    manual.push({
      id: "untrack-env",
      title: "Remove .env from GitHub history",
      detail:
        "If this project is already on GitHub, your .env file may be there too. Run `git rm --cached .env`, then commit. Older copies stay in history, so rotate those keys as well.",
    });
  }

  manual.push({
    id: "hosting-env",
    title: "Add your keys to your hosting provider",
    detail:
      "Your .env file stays on your computer. Add the same variables to your host (Vercel, Netlify, Replit Secrets…) in its Environment Variables settings so the live site keeps working.",
  });

  const rotations = buildRotations(findings);
  const report = buildReport({ projectName, findings, manual, rotations, changed: [...changed.keys()] });
  changed.set(REPORT_PATH, report);

  const changes: FileChange[] = [...changed].map(([path, content]) =>
    buildChange(path, byPath.get(path)?.content, content, secrets),
  );
  changes.sort((a, b) => Number(a.path === REPORT_PATH) - Number(b.path === REPORT_PATH) || a.path.localeCompare(b.path));

  return {
    files: [...changed].map(([path, content]) => ({ path, content })),
    plan: { changes, manualSteps: dedupeSteps(manual), rotations },
    findings,
  };
}

function dedupeSteps(steps: ManualStep[]): ManualStep[] {
  const seen = new Set<string>();
  return steps.filter((s) => {
    const key = s.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildRotations(findings: RawFinding[]): Rotation[] {
  const bySecret = new Map<string, RawFinding>();
  for (const f of findings) if (!bySecret.has(f.secret)) bySecret.set(f.secret, f);
  return [...bySecret.values()].map((f) => {
    const steps =
      f.ruleId === "database-url"
        ? ["Open your database dashboard", "Change the password for this database user", `Put the new connection string in .env as ${f.envName}`]
        : f.ruleId === "private-key"
          ? ["Generate a new key pair", "Install the new public key wherever the old one was trusted", `Put the new private key in .env as ${f.envName}`, "Remove the old public key"]
          : f.publicByDesign
            ? [
                `Open the ${f.provider} credentials page`,
                "Restrict the key to your website's domain (HTTP referrer restriction)",
                "Limit it to only the APIs your app uses",
                "If it was used somewhere you don't recognise, create a new key and delete this one",
              ]
            : [
                `Open the ${f.provider} keys page`,
                "Create a new key",
                `Paste the new key into .env as ${f.envName}`,
                `Delete (revoke) the old key ending in ${f.masked.slice(-4)}`,
              ];
    return { provider: f.provider, envName: f.envName, masked: f.masked, rotateUrl: f.rotateUrl, steps };
  });
}
