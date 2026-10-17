import type { Exposure, Framework, SourceFile } from "../types";

const PUBLIC_ENV_PREFIX = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/;

export function isPublicEnvName(name: string): boolean {
  return PUBLIC_ENV_PREFIX.test(name);
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** `.env`, `.env.local`, `.env.production`… */
export function isEnvFile(path: string): boolean {
  return /^\.env(\.[\w.-]+)?$/.test(basename(path));
}

export function isEnvTemplate(path: string): boolean {
  return /^\.env\.(example|sample|template|dist|defaults)$/.test(basename(path));
}

export function detectFramework(files: SourceFile[]): Framework {
  const paths = new Set(files.map((f) => f.path));
  const pkg = files.find((f) => f.path === "package.json");
  let deps: Record<string, string> = {};
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = { ...parsed.dependencies, ...parsed.devDependencies };
    } catch {
      // Broken package.json: fall through to file-based detection.
    }
  }
  const has = (p: RegExp) => [...paths].some((x) => p.test(x));
  if (deps.next || has(/^next\.config\.(js|mjs|ts|cjs)$/)) return "next";
  if (deps.vite || has(/^vite\.config\.(js|mjs|ts|cjs)$/)) return "vite";
  if (deps["react-scripts"]) return "cra";
  if (pkg) return "node";
  if (has(/\.py$/)) return "python";
  if (has(/\.html$/)) return "static";
  return "unknown";
}

const CONFIG_EXT = new Set(["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "properties", "plist", "md", "txt"]);
const SERVER_EXT = new Set(["py", "rb", "go", "php", "java", "kt", "cs", "rs", "ex", "exs", "sh"]);
const CLIENT_EXT = new Set(["html", "htm", "vue", "svelte"]);

/**
 * Decide whether a file ends up in the browser. This is a heuristic: when we
 * are unsure about a JS/TS file we lean towards "frontend" for Vite/CRA apps,
 * where almost everything under src/ is bundled for the browser.
 */
export function classifyExposure(file: SourceFile, framework: Framework): Exposure {
  const path = file.path;
  const ext = extension(path);
  const parts = path.toLowerCase().split("/");

  if (isEnvFile(path)) return "env-file";
  if (CLIENT_EXT.has(ext)) return "frontend";
  if (SERVER_EXT.has(ext)) return "server";
  if (CONFIG_EXT.has(ext)) return "config";

  const isScript = /^(js|jsx|ts|tsx|mjs|cjs|astro)$/.test(ext);
  if (!isScript) return "config";

  const head = file.content.slice(0, 400);
  if (/^\s*(['"])use client\1/m.test(head)) return "frontend";
  if (/^\s*(['"])use server\1/m.test(head)) return "server";

  const serverDir = parts.some((p) =>
    ["api", "server", "backend", "functions", "netlify", "supabase", "scripts", "prisma", "workers"].includes(p),
  );
  const name = basename(path).toLowerCase();
  if (serverDir || /^(route|middleware|proxy|server|instrumentation)\.(js|ts|mjs|cjs)$/.test(name)) return "server";
  if (/\.server\.(js|ts|jsx|tsx)$/.test(name) || /^(next|vite|tailwind|postcss|eslint)\.config\./.test(name)) return "server";

  if (parts.includes("public")) return "frontend";

  if (framework === "next") {
    // Pages router pages and shared components run in the browser.
    // App router files are server components unless marked "use client".
    if (parts[0] === "pages" || (parts[0] === "src" && parts[1] === "pages")) return "frontend";
    if (parts.some((p) => ["components", "hooks", "context", "contexts", "store"].includes(p))) return "frontend";
    return "server";
  }

  if (framework === "vite" || framework === "cra" || framework === "static") {
    return "frontend";
  }

  if (parts.some((p) => ["components", "hooks", "pages", "views", "client", "frontend", "web"].includes(p))) {
    return "frontend";
  }
  return "server";
}
