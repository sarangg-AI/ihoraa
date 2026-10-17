// Which files are worth scanning. Shared by the browser (to keep uploads small)
// and the server (so the API never trusts the client's filtering).

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_FILES = 8000;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  ".turbo",
  ".cache",
  ".expo",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "Pods",
  ".gradle",
  ".idea",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  ".DS_Store",
]);

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|psd|svgz|mp[34]|mov|avi|webm|wav|ogg|flac|m4a|woff2?|ttf|otf|eot|zip|gz|tgz|rar|7z|tar|pdf|docx?|xlsx?|pptx?|exe|dll|so|dylib|bin|wasm|class|jar|pyc|db|sqlite3?|lockb|map)$/i;

/** True for paths inside dependency, build or VCS folders. These are left out of the output zip too. */
export function isIgnoredDir(path: string): boolean {
  return path.split("/").some((part) => SKIP_DIRS.has(part));
}

/** True when a file should be read as text and scanned. */
export function isScannable(path: string, size: number): boolean {
  if (isIgnoredDir(path)) return false;
  const name = path.split("/").pop() ?? path;
  if (SKIP_FILES.has(name)) return false;
  if (BINARY_EXT.test(name)) return false;
  if (/\.min\.(js|css)$/i.test(name)) return false;
  return size <= MAX_FILE_BYTES;
}

/** Text that contains NUL bytes in its first 8 KB is almost always binary. */
export function looksBinary(content: string): boolean {
  return content.slice(0, 8192).includes("\u0000");
}

/** Normalise Windows paths and strip leading "./" or "/". */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

/**
 * If every path shares one top-level folder (typical for `project-main.zip`),
 * strip it and return it as the project name.
 */
export function stripCommonRoot(paths: string[]): { root: string | null; strip: (p: string) => string } {
  if (paths.length === 0) return { root: null, strip: (p) => p };
  const first = paths[0].split("/")[0];
  const shared = paths.every((p) => p.includes("/") && p.split("/")[0] === first);
  if (!shared) return { root: null, strip: (p) => p };
  return { root: first, strip: (p) => p.slice(first.length + 1) };
}
