import type { Exposure, Framework } from "../types";
import { extension } from "../scanner/exposure";

export type Lang = "js" | "ts" | "py" | "rb" | "php" | "go" | "java" | "cs" | "rs" | "yaml" | "other";

export function languageOf(path: string): Lang {
  const ext = extension(path);
  if (["js", "jsx", "mjs", "cjs", "vue", "svelte", "astro"].includes(ext)) return "js";
  if (["ts", "tsx", "mts", "cts"].includes(ext)) return "ts";
  if (ext === "py") return "py";
  if (ext === "rb") return "rb";
  if (ext === "php") return "php";
  if (ext === "go") return "go";
  if (["java", "kt"].includes(ext)) return "java";
  if (ext === "cs") return "cs";
  if (ext === "rs") return "rs";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  return "other";
}

/** Prefix that makes a variable visible to browser code, per framework. */
export function publicPrefix(framework: Framework): string | null {
  if (framework === "next") return "NEXT_PUBLIC_";
  if (framework === "vite") return "VITE_";
  if (framework === "cra") return "REACT_APP_";
  return null;
}

/** Documentation files: keys there are redacted, never rewired. */
export function isDocFile(path: string): boolean {
  return /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(path);
}

/**
 * Code that reads an env variable in the given language. Returns null when the
 * file has no standard way to read env variables (JSON, Markdown, plain HTML…).
 */
export function envExpression(lang: Lang, name: string, opts: { exposure: Exposure; framework: Framework }): string | null {
  switch (lang) {
    case "js":
    case "ts": {
      const bang = lang === "ts" ? "!" : "";
      if (opts.exposure === "frontend" && opts.framework === "vite") return `import.meta.env.${name}`;
      return `process.env.${name}${bang}`;
    }
    case "py":
      return `os.environ["${name}"]`;
    case "rb":
      return `ENV["${name}"]`;
    case "php":
      return `getenv('${name}')`;
    case "go":
      return `os.Getenv("${name}")`;
    case "java":
      return `System.getenv("${name}")`;
    case "cs":
      return `Environment.GetEnvironmentVariable("${name}")`;
    case "rs":
      return `std::env::var("${name}").unwrap()`;
    default:
      // YAML is handled by the fixer: only docker-compose and GitHub Actions
      // files can read variables, each with its own syntax.
      return null;
  }
}

export function concatOperator(lang: Lang): string {
  return lang === "php" ? "." : "+";
}

export function lineComment(lang: Lang): string | null {
  if (["js", "ts", "php", "go", "java", "cs", "rs"].includes(lang)) return "//";
  if (["py", "rb", "yaml"].includes(lang)) return "#";
  return null;
}
