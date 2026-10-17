import JSZip from "jszip";
import {
  isIgnoredDir,
  isScannable,
  looksBinary,
  MAX_FILE_BYTES,
  MAX_FILES,
  normalizePath,
  stripCommonRoot,
} from "../scanner/walk";
import type { SourceFile } from "../types";

/** One file of the uploaded project, kept in browser memory only. */
export interface ProjectEntry {
  path: string;
  size: number;
  /** Text content for files we scan. Undefined for binaries and large files. */
  text?: string;
  /** Raw bytes, read lazily when building the output zip. */
  read: () => Promise<Blob | Uint8Array | string>;
}

export interface Project {
  name: string;
  entries: ProjectEntry[];
}

export type ProgressFn = (read: number, total: number) => void;

export class UploadError extends Error {}

export function sourceFiles(project: Project): SourceFile[] {
  return project.entries.filter((e) => e.text !== undefined).map((e) => ({ path: e.path, content: e.text! }));
}

async function finalize(name: string, raw: { path: string; size: number; file: () => Promise<Blob | Uint8Array | string>; text: () => Promise<string> }[], onProgress?: ProgressFn): Promise<Project> {
  const kept = raw.map((r) => ({ ...r, path: normalizePath(r.path) })).filter((r) => r.path && !isIgnoredDir(r.path));
  if (kept.length === 0) throw new UploadError("We couldn't find any files in that upload.");
  if (kept.length > MAX_FILES) throw new UploadError(`That project has more than ${MAX_FILES} files. Try zipping just your app folder.`);

  const { root, strip } = stripCommonRoot(kept.map((k) => k.path));
  const entries: ProjectEntry[] = [];
  let done = 0;
  for (const r of kept) {
    const path = strip(r.path);
    let text: string | undefined;
    if (isScannable(path, r.size)) {
      const content = await r.text();
      // Zip entries may report size 0, so re-check the real length here.
      if (!looksBinary(content) && content.length <= MAX_FILE_BYTES) text = content;
    }
    entries.push({ path, size: r.size, text, read: r.file });
    onProgress?.(++done, kept.length);
  }
  return { name: root ?? name, entries };
}

export async function readZip(file: File, onProgress?: ProgressFn): Promise<Project> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new UploadError("That file doesn't look like a valid .zip archive.");
  }
  const raw = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith("__MACOSX/"))
    .map((f) => ({
      path: f.name,
      // JSZip exposes the uncompressed size on its internal data object.
      size: (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
      file: () => f.async("uint8array"),
      text: () => f.async("string"),
    }));
  return finalize(file.name.replace(/\.zip$/i, ""), raw, onProgress);
}

/** From an `<input webkitdirectory>` or a multi-file picker. */
export async function readFileList(files: File[], onProgress?: ProgressFn): Promise<Project> {
  const raw = files.map((f) => ({
    path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    size: f.size,
    file: async () => f,
    text: () => f.text(),
  }));
  return finalize("my-project", raw, onProgress);
}

/** From a drag-and-drop of a folder. Walks the tree but never enters node_modules & co. */
export async function readDroppedItems(items: DataTransferItemList, onProgress?: ProgressFn): Promise<Project> {
  const roots = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  // A single dropped zip file.
  if (roots.length === 1 && roots[0].isFile && /\.zip$/i.test(roots[0].name)) {
    const file = await new Promise<File>((res, rej) => (roots[0] as FileSystemFileEntry).file(res, rej));
    return readZip(file, onProgress);
  }

  const files: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isIgnoredDir(path)) return;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      files.push(file);
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches; keep reading until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, path);
      if (files.length > MAX_FILES) throw new UploadError(`That project has more than ${MAX_FILES} files. Try zipping just your app folder.`);
    }
  };
  for (const r of roots) await walk(r, "");
  const name = roots.length === 1 && roots[0].isDirectory ? roots[0].name : "my-project";
  const project = await readFileList(files, onProgress);
  return { ...project, name: project.name === "my-project" ? name : project.name };
}

/** Original files plus Ihoraa's changes, zipped under the project folder name. */
export async function buildSecuredZip(project: Project, changed: SourceFile[]): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder(`${project.name}-secured`)!;
  const overrides = new Map(changed.map((c) => [c.path, c.content]));
  for (const e of project.entries) {
    if (overrides.has(e.path)) continue;
    folder.file(e.path, e.text ?? (await e.read()));
  }
  for (const [path, content] of overrides) folder.file(path, content);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
