"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { buildSecuredZip, readDroppedItems, readFileList, readZip, sourceFiles, UploadError, type Project } from "@/lib/client/project";
import { demoProject } from "@/lib/client/demo";
import { MAX_UPLOAD_BYTES, tooLargeMessage } from "@/lib/scanner/walk";
import type { ScanResult, SourceFile } from "@/lib/types";
import { FixView, type DownloadState } from "./FixView";
import { ResultsView } from "./ResultsView";
import { ScanningView, type ScanPhase } from "./ScanningView";
import { Logo, cn } from "./ui";
import { UploadView } from "./UploadView";

type Step =
  | { name: "upload" }
  | { name: "scanning"; phase: ScanPhase; read: number; total: number; projectName?: string }
  | { name: "results" }
  | { name: "fix" };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const json = JSON.stringify(body);
  // Check before sending: the host rejects oversized requests with a bare error page.
  const bytes = new Blob([json]).size;
  if (bytes > MAX_UPLOAD_BYTES) throw new UploadError(tooLargeMessage(bytes));
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: json });
  if (res.status === 413) throw new UploadError(tooLargeMessage());
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

const STEPS = [
  { id: "upload", label: "Upload" },
  { id: "results", label: "Review" },
  { id: "fix", label: "Secure" },
] as const;

function Stepper({ step }: { step: Step["name"] }) {
  const index = step === "upload" || step === "scanning" ? 0 : step === "results" ? 1 : 2;
  return (
    <ol className="hidden items-center gap-2 text-xs font-medium sm:flex" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-2 rounded-full px-2.5 py-1",
              i === index ? "bg-accent-soft text-accent-strong" : i < index ? "text-ok" : "text-dim",
            )}
            aria-current={i === index ? "step" : undefined}
          >
            <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", i === index ? "bg-accent text-white" : i < index ? "bg-ok-soft" : "border border-border-strong")}>
              {i < index ? "✓" : i + 1}
            </span>
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-border-strong" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

export function IhoraaApp() {
  const [step, setStep] = useState<Step>({ name: "upload" });
  const [project, setProject] = useState<Project | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState>("idle");
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const restart = useCallback(() => {
    setProject(null);
    setResult(null);
    setError(null);
    setDownload("idle");
    setDownloadError(null);
    setStep({ name: "upload" });
    window.scrollTo({ top: 0 });
  }, []);

  const run = useCallback(async (load: (onProgress: (read: number, total: number) => void) => Promise<Project>) => {
    setError(null);
    setStep({ name: "scanning", phase: "reading", read: 0, total: 0 });
    try {
      const p = await load((read, total) => setStep({ name: "scanning", phase: "reading", read, total }));
      const files: SourceFile[] = sourceFiles(p);
      if (files.length === 0) throw new UploadError("We couldn't find any code files to scan in that upload.");
      setProject(p);
      setStep({ name: "scanning", phase: "scanning", read: 0, total: 0, projectName: p.name });
      const minDelay = new Promise((r) => setTimeout(r, 900)); // let people see what is happening
      const scan = await postJson<ScanResult>("/api/scan", { projectName: p.name, files });
      setStep({ name: "scanning", phase: "preparing", read: 0, total: 0, projectName: p.name });
      await minDelay;
      setResult(scan);
      setDownload("idle");
      setStep({ name: "results" });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload couldn't be read.");
      setStep({ name: "upload" });
    }
  }, []);

  const downloadZip = useCallback(async () => {
    if (!project) return;
    setDownload("working");
    setDownloadError(null);
    try {
      const { files } = await postJson<{ files: SourceFile[] }>("/api/fix", { projectName: project.name, files: sourceFiles(project) });
      const blob = await buildSecuredZip(project, files);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name}-secured.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDownload("done");
    } catch (err) {
      setDownload("error");
      setDownloadError(err instanceof Error ? err.message : "Download failed. Please try again.");
    }
  }, [project]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <button onClick={restart} className="cursor-pointer" aria-label="Ihoraa home">
            <Logo />
          </button>
          <Stepper step={step.name} />
          <Link href="/privacy" className="text-xs font-medium text-muted hover:text-text">
            Privacy
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {step.name === "upload" && (
          <UploadView
            error={error}
            onZip={(file) => run((onProgress) => readZip(file, onProgress))}
            onFiles={(files) => run((onProgress) => readFileList(files, onProgress))}
            onDrop={(items) => run((onProgress) => readDroppedItems(items, onProgress))}
            onDemo={() => run(async () => demoProject())}
          />
        )}
        {step.name === "scanning" && <ScanningView phase={step.phase} read={step.read} total={step.total} projectName={step.projectName} />}
        {step.name === "results" && result && (
          <ResultsView
            result={result}
            onRestart={restart}
            onSecure={() => {
              setStep({ name: "fix" });
              window.scrollTo({ top: 0 });
            }}
          />
        )}
        {step.name === "fix" && result && (
          <FixView result={result} download={download} onDownload={downloadZip} onBack={() => setStep({ name: "results" })} error={downloadError} />
        )}
      </main>

      <footer className="border-t border-border/70 py-6 text-center text-xs text-dim">
        Ihoraa · Your code is scanned in memory and never stored. ·{" "}
        <Link href="/privacy" className="underline-offset-2 hover:text-muted hover:underline">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
