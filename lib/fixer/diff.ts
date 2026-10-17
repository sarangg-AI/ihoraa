import { diffLines } from "diff";
import type { DiffLine, FileChange } from "../types";
import { maskSecret } from "../scanner/mask";

const CONTEXT = 3;

/** Replace every known secret with its masked form so diffs are safe to show. */
export function maskAll(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join(maskSecret(s));
  // Secrets written to .env with escaped newlines (private keys).
  for (const s of secrets) if (s.includes("\n")) out = out.split(s.replace(/\r?\n/g, "\\n")).join(maskSecret(s));
  return out;
}

export function buildChange(path: string, before: string | undefined, after: string, secrets: string[]): FileChange {
  const oldText = before === undefined ? "" : maskAll(before, secrets);
  const newText = maskAll(after, secrets);
  const parts = diffLines(oldText, newText);

  const all: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of parts) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      if (part.added) all.push({ kind: "add", text, newLine: newLine++ });
      else if (part.removed) all.push({ kind: "del", text, oldLine: oldLine++ });
      else all.push({ kind: "ctx", text, oldLine: oldLine++, newLine: newLine++ });
    }
  }

  // Keep only a few lines of context around each change.
  const keep = new Set<number>();
  all.forEach((l, i) => {
    if (l.kind === "ctx") return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(all.length - 1, i + CONTEXT); j++) keep.add(j);
  });
  const lines: DiffLine[] = [];
  let skipped = false;
  all.forEach((l, i) => {
    if (keep.has(i)) {
      if (skipped && lines.length) lines.push({ kind: "ctx", text: "…" });
      skipped = false;
      lines.push({ ...l, text: l.text.length > 220 ? l.text.slice(0, 217) + "..." : l.text });
    } else {
      skipped = true;
    }
  });

  return {
    path,
    kind: before === undefined ? "added" : "modified",
    lines: lines.slice(0, 400),
    additions: all.filter((l) => l.kind === "add").length,
    deletions: all.filter((l) => l.kind === "del").length,
  };
}
