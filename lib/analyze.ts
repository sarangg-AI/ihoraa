import { buildFix, type FixOutput } from "./fixer";
import { scanFiles, securityScore } from "./scanner";
import { MAX_FILES, MAX_UPLOAD_BYTES, tooLargeMessage } from "./scanner/walk";
import type { Finding, RawFinding, ScanRequest, ScanResult } from "./types";

export class BadRequest extends Error {}

function toPublic(f: RawFinding): Finding {
  // Drop the raw secret and its offsets: only the masked value reaches the browser.
  const { secret: _secret, start: _start, end: _end, ...rest } = f;
  void _secret;
  void _start;
  void _end;
  return rest;
}

export function parseScanRequest(body: unknown): ScanRequest {
  if (!body || typeof body !== "object") throw new BadRequest("Expected a JSON body.");
  const { projectName, files } = body as Partial<ScanRequest>;
  if (!Array.isArray(files)) throw new BadRequest("Expected a list of files.");
  if (files.length > MAX_FILES) throw new BadRequest(`Projects are limited to ${MAX_FILES} files.`);
  const clean = files.filter(
    (f): f is { path: string; content: string } =>
      !!f && typeof f.path === "string" && typeof f.content === "string" && f.path.length < 1024,
  );
  // The browser checks the exact byte size before sending; this is the server's
  // own guard for hosts without a body limit. Characters approximate bytes here.
  const total = clean.reduce((n, f) => n + f.path.length + f.content.length, 0);
  if (total > MAX_UPLOAD_BYTES) throw new BadRequest(tooLargeMessage(total));
  const name = typeof projectName === "string" && projectName.trim() ? projectName.trim().slice(0, 100) : "my-project";
  return { projectName: name, files: clean };
}

export function analyze(req: ScanRequest): { result: ScanResult; fix: FixOutput } {
  const scan = scanFiles(req.files);
  const fix = buildFix(scan, req.projectName);
  const result: ScanResult = {
    projectName: req.projectName,
    framework: scan.framework,
    stats: { filesScanned: scan.files.length, linesScanned: scan.linesScanned },
    score: securityScore(scan.findings),
    findings: fix.findings.map(toPublic),
    plan: fix.plan,
  };
  return { result, fix };
}
