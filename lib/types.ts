// Shared types between the scanner, the fixer, the API routes and the UI.
// Anything sent to the browser must never contain a raw secret: only `masked`.

export type Severity = "critical" | "high" | "medium";

/** Where the key lives, which decides how dangerous it is and how we fix it. */
export type Exposure = "frontend" | "server" | "env-file" | "config";

export type Framework = "next" | "vite" | "cra" | "node" | "python" | "static" | "unknown";

export interface SourceFile {
  path: string;
  content: string;
}

export interface SnippetLine {
  line: number;
  text: string;
  highlight: boolean;
}

/** A finding as shown in the UI. Safe to send to the browser. */
export interface Finding {
  id: string;
  ruleId: string;
  provider: string;
  title: string;
  whatItCanDo: string;
  severity: Severity;
  exposure: Exposure;
  file: string;
  line: number;
  column: number;
  masked: string;
  snippet: SnippetLine[];
  envName: string;
  /** Keys designed to be used in browsers (e.g. Google Maps). Still worth restricting. */
  publicByDesign: boolean;
  rotateUrl?: string;
  fixSummary: string;
}

/** Internal finding. Holds the raw secret and offsets. Never leaves the server as-is. */
export interface RawFinding extends Finding {
  secret: string;
  start: number;
  end: number;
}

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface FileChange {
  path: string;
  kind: "modified" | "added";
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface ManualStep {
  id: string;
  title: string;
  detail: string;
  file?: string;
  /** Ready-to-paste instruction for the user's AI coding tool. */
  aiPrompt?: string;
}

export interface Rotation {
  provider: string;
  envName: string;
  masked: string;
  rotateUrl?: string;
  steps: string[];
}

export interface FixPlan {
  changes: FileChange[];
  manualSteps: ManualStep[];
  rotations: Rotation[];
}

export interface ScanStats {
  filesScanned: number;
  linesScanned: number;
}

/** A match the code marked as not secret (`ihoraa-ignore`). Location only, never the value. */
export interface IgnoredFinding {
  file: string;
  line: number;
}

export interface ScanResult {
  projectName: string;
  framework: Framework;
  stats: ScanStats;
  score: number;
  findings: Finding[];
  /** Shown to the user so a marker can never hide a leak silently. */
  ignored: IgnoredFinding[];
  plan: FixPlan;
}

export interface ScanRequest {
  projectName: string;
  files: SourceFile[];
}
