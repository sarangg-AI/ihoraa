"use client";

import { useState } from "react";
import { ArrowLeft, Bot, Check, ChevronDown, CircleCheck, Copy, Download, ExternalLink, FileText, LoaderCircle, RotateCcw } from "lucide-react";
import type { FileChange, ManualStep, Rotation, ScanResult } from "@/lib/types";
import { Button, Card, cn, ProviderMark } from "./ui";

export type DownloadState = "idle" | "working" | "done" | "error";

function CopyButton({ text, label = "Copy prompt for your AI tool" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard blocked: leave the prompt visible for manual copy.
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function RotationChecklist({ rotations }: { rotations: Rotation[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <RotateCcw className="size-4 text-warn" aria-hidden />
            Replace your exposed keys
          </h2>
          <p className="mt-0.5 text-sm text-muted">These keys were in your code, so assume they&apos;ve been copied. Create new ones and delete the old ones.</p>
        </div>
        <span className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium tabular-nums text-muted">
          {done.size} of {rotations.length} done
        </span>
      </div>
      <ul>
        {rotations.map((r, i) => (
          <li key={`${r.envName}-${i}`} className={cn("border-b border-border px-5 py-4 last:border-b-0", done.has(i) && "opacity-60")}>
            <div className="flex items-start gap-4">
              <input
                id={`rot-${i}`}
                type="checkbox"
                checked={done.has(i)}
                onChange={() => toggle(i)}
                className="mt-2 size-4 shrink-0 cursor-pointer accent-[var(--ok)]"
              />
              <ProviderMark provider={r.provider} size="sm" />
              <div className="min-w-0 flex-1">
                <label htmlFor={`rot-${i}`} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={cn("font-medium", done.has(i) && "line-through")}>{r.provider}</span>
                  <code className="font-mono text-xs text-muted">{r.envName}</code>
                  <code className="truncate font-mono text-xs text-dim">{r.masked}</code>
                </label>
                <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-muted">
                  {r.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
              {r.rotateUrl && (
                <a
                  href={r.rotateUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-2 sm:inline-flex"
                >
                  Open dashboard <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
            {r.rotateUrl && (
              <a href={r.rotateUrl} target="_blank" rel="noreferrer noopener" className="mt-3 ml-8 inline-flex items-center gap-1.5 text-xs font-medium text-accent-strong sm:hidden">
                Open dashboard <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ManualSteps({ steps }: { steps: ManualStep[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 font-medium">
          <Bot className="size-4 text-accent" aria-hidden />
          Finish up
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          A few things need a human or your AI coding tool. Each step has a ready-to-paste prompt for Cursor, Lovable, Bolt or Replit.
        </p>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.id} className="border-b border-border px-5 py-4 last:border-b-0">
            <div className="flex gap-4">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted">{s.detail}</p>
                {s.aiPrompt && (
                  <div className="mt-3">
                    <CopyButton text={s.aiPrompt} />
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function DiffBlock({ change }: { change: FileChange }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border last:border-b-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-surface-2/60">
        <ChevronDown className={cn("size-4 shrink-0 text-dim transition-transform", !open && "-rotate-90")} aria-hidden />
        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{change.path}</span>
        {change.kind === "added" && <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[11px] font-medium text-ok">new</span>}
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-ok">+{change.additions}</span> <span className="text-danger">-{change.deletions}</span>
        </span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-bg py-2 font-mono text-[12.5px] leading-6">
          {change.lines.map((l, i) =>
            l.oldLine === undefined && l.newLine === undefined ? (
              <div key={i} className="px-5 text-dim">
                {l.text}
              </div>
            ) : (
              <div key={i} className={cn("flex px-5", l.kind === "add" && "bg-ok-soft", l.kind === "del" && "bg-danger-soft")}>
                <span className="w-10 shrink-0 select-none text-right text-dim">{l.oldLine ?? ""}</span>
                <span className="w-10 shrink-0 select-none text-right text-dim">{l.newLine ?? ""}</span>
                <span className={cn("w-5 shrink-0 select-none text-center", l.kind === "add" ? "text-ok" : l.kind === "del" ? "text-danger" : "text-dim")}>
                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                </span>
                <span className="whitespace-pre text-text">{l.text || " "}</span>
              </div>
            ),
          )}
        </pre>
      )}
    </li>
  );
}

export function FixView({
  result,
  download,
  onDownload,
  onBack,
  error,
}: {
  result: ScanResult;
  download: DownloadState;
  onDownload: () => void;
  onBack: () => void;
  error?: string | null;
}) {
  const { plan } = result;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-20 pt-8 sm:px-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3">
          <ArrowLeft className="size-4" aria-hidden />
          Back to results
        </Button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Secure {result.projectName}</h1>
        <p className="mt-1 text-muted">Three steps: download the fixed project, replace your keys, then finish a few small tasks.</p>
      </div>

      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-medium">
              {download === "done" ? <CircleCheck className="size-5 text-ok" aria-hidden /> : <Download className="size-5 text-accent" aria-hidden />}
              {download === "done" ? "Your secured project is downloaded" : "Download your secured project"}
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              <li>• Hard-coded keys moved out of your code into a private <code className="font-mono text-text">.env</code> file</li>
              <li>• <code className="font-mono text-text">.gitignore</code> updated so <code className="font-mono text-text">.env</code> never reaches GitHub</li>
              <li>• Includes <code className="font-mono text-text">IHORAA_REPORT.md</code> with every step below</li>
            </ul>
            <p className="mt-3 text-xs text-dim">Unzip and copy the files over your project folder. Your git history and node_modules aren&apos;t touched.</p>
          </div>
          <Button size="lg" onClick={onDownload} disabled={download === "working"} className="shrink-0">
            {download === "working" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {download === "working" ? "Securing..." : download === "done" ? "Download again" : "Secure & download .zip"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="relative mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </Card>

      {plan.rotations.length > 0 && <RotationChecklist rotations={plan.rotations} />}
      {plan.manualSteps.length > 0 && <ManualSteps steps={plan.manualSteps} />}

      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-medium">What changes in your code</h2>
          <p className="mt-0.5 text-sm text-muted">
            {plan.changes.length} files. Keys are masked here; the real values only go into your downloaded <code className="font-mono">.env</code>.
          </p>
        </div>
        <ul>
          {plan.changes.map((c) => (
            <DiffBlock key={c.path} change={c} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
