"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronRight, CircleCheck, ExternalLink, EyeOff, Info, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { Finding, IgnoredFinding, ScanResult, Severity } from "@/lib/types";
import { Button, Card, cn, EXPOSURE_INFO, ExposureBadge, ProviderMark, SeverityBadge } from "./ui";

const FRAMEWORK_LABEL: Record<ScanResult["framework"], string> = {
  next: "Next.js",
  vite: "Vite",
  cra: "Create React App",
  node: "Node.js",
  python: "Python",
  static: "Static site",
  unknown: "Project",
};

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? "var(--ok)" : score >= 60 ? "var(--warn)" : "var(--critical)";
  const label = score >= 90 ? "Secure" : score >= 60 ? "Needs attention" : "At risk";
  return (
    <div className="flex items-center gap-5">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - score / 100)}
            style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums">{score}</span>
          <span className="text-[11px] text-dim">out of 100</span>
        </div>
      </div>
      <div>
        <p className="text-sm text-muted">Security score</p>
        <p className="mt-0.5 text-xl font-semibold" style={{ color }}>
          {label}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "critical" | "danger" | "warn" | "accent" }) {
  const color = { critical: "text-critical", danger: "text-danger", warn: "text-warn", accent: "text-accent-strong" }[tone];
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", value > 0 ? color : "text-dim")}>{value}</p>
    </Card>
  );
}

type Filter = "all" | Severity | "browser";

export function FindingDrawer({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const exposure = EXPOSURE_INFO[finding.exposure];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-label="Close details" />
      <div className="animate-fade-up relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-bg-elev shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div className="flex items-start gap-3">
            <ProviderMark provider={finding.provider} />
            <div>
              <h2 id="drawer-title" className="text-lg font-semibold">{finding.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <SeverityBadge severity={finding.severity} />
                <ExposureBadge exposure={finding.exposure} />
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="space-y-6 p-6">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-dim">What could happen</h3>
            <p className="mt-2 text-sm leading-relaxed">{finding.whatItCanDo}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-dim">Where we found it</h3>
            <p className="mt-2 font-mono text-sm text-accent-strong break-all">
              {finding.file}:{finding.line}
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[12.5px] leading-6">
              {finding.snippet.map((l) => (
                <div key={l.line} className={cn("flex", l.highlight && "-mx-3 bg-critical-soft px-3")}>
                  <span className="mr-4 w-8 shrink-0 select-none text-right text-dim">{l.line}</span>
                  <span className={cn("whitespace-pre", l.highlight ? "text-text" : "text-muted")}>{l.text || " "}</span>
                </div>
              ))}
            </pre>
            <p className="mt-3 flex items-start gap-2 text-sm text-muted">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {exposure.help}
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-dim">How Ihoraa fixes it</h3>
            <p className="mt-2 flex items-start gap-2 text-sm">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              {finding.fixSummary}
            </p>
            <p className="mt-2 flex items-start gap-2 text-sm">
              <RotateCcw className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              {finding.publicByDesign
                ? "Then restrict this key to your own website in the provider's dashboard."
                : "Then create a new key and delete this one. It has been exposed, so assume someone has a copy."}
            </p>
            {finding.rotateUrl && (
              <a
                href={finding.rotateUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline"
              >
                Open {finding.provider} key settings
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Lists matches the code marked as not secret, so a marker never hides a leak silently. */
function IgnoredNote({ ignored, className }: { ignored: IgnoredFinding[]; className?: string }) {
  if (ignored.length === 0) return null;
  const shown = ignored.slice(0, 5);
  const n = ignored.length;
  return (
    <Card className={cn("flex items-start gap-3 p-4 text-left text-sm text-muted", className)}>
      <EyeOff className="mt-0.5 size-5 shrink-0 text-dim" aria-hidden />
      <p>
        <span className="font-medium text-text">
          {n} possible {n === 1 ? "key was" : "keys were"} skipped
        </span>{" "}
        because the code marks {n === 1 ? "it" : "them"} as not secret (<code className="font-mono">ihoraa-ignore</code> or{" "}
        <code className="font-mono">gitleaks:allow</code>):{" "}
        {shown.map((g, i) => (
          <span key={`${g.file}:${g.line}`}>
            {i > 0 && ", "}
            <span className="font-mono text-xs text-accent-strong">
              {g.file}:{g.line}
            </span>
          </span>
        ))}
        {n > shown.length && ` and ${n - shown.length} more`}. If you didn&apos;t add these markers yourself, check those lines.
      </p>
    </Card>
  );
}

function CleanResult({ result, onRestart }: { result: ScanResult; onRestart: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-ok-soft ring-1 ring-ok/30">
        <CircleCheck className="size-10 text-ok" aria-hidden />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">No exposed keys found</h1>
      <p className="mt-3 text-muted">
        We checked {result.stats.filesScanned.toLocaleString()} files in {result.projectName} and didn&apos;t find any leaked API keys. Nice work.
      </p>
      <Card className="mt-8 p-5 text-left text-sm text-muted">
        <p className="font-medium text-text">Keep it that way</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Keep keys in a .env file and make sure .gitignore lists it.</li>
          <li>Never paste a secret key into code that runs in the browser.</li>
          <li>Scan again whenever your AI tool adds a new integration.</li>
        </ul>
      </Card>
      <IgnoredNote ignored={result.ignored} className="mt-4" />
      <Button className="mt-8" variant="secondary" onClick={onRestart}>
        Scan another project
      </Button>
    </div>
  );
}

export function ResultsView({ result, onSecure, onRestart }: { result: ScanResult; onSecure: () => void; onRestart: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Finding | null>(null);

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, browser: 0 };
    for (const f of result.findings) {
      c[f.severity]++;
      if (f.exposure === "frontend") c.browser++;
    }
    return c;
  }, [result.findings]);

  const shown = result.findings.filter((f) =>
    filter === "all" ? true : filter === "browser" ? f.exposure === "frontend" : f.severity === filter,
  );

  if (result.findings.length === 0) return <CleanResult result={result} onRestart={onRestart} />;

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: result.findings.length },
    { id: "critical", label: "Critical", count: counts.critical },
    { id: "high", label: "High", count: counts.high },
    { id: "medium", label: "Medium", count: counts.medium },
    { id: "browser", label: "In browser", count: counts.browser },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-32 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Scan results</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{result.projectName}</h1>
          <p className="mt-1 text-sm text-dim">
            {FRAMEWORK_LABEL[result.framework]} · {result.stats.filesScanned.toLocaleString()} files · {result.stats.linesScanned.toLocaleString()} lines scanned
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRestart}>
          Scan a different project
        </Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <Card className="flex items-center p-6">
          <ScoreRing score={result.score} />
        </Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Critical" value={counts.critical} tone="critical" />
          <Stat label="High" value={counts.high} tone="danger" />
          <Stat label="Medium" value={counts.medium} tone="warn" />
          <Stat label="Visible in browser" value={counts.browser} tone="accent" />
          <Card className="col-span-2 flex items-start gap-3 p-4 sm:col-span-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
            <p className="text-sm text-muted">
              <span className="font-medium text-text">Fixing the code is step one.</span> A key that was ever in your code or on GitHub should be treated as stolen. After securing, Ihoraa gives you a checklist to replace each one.
            </p>
          </Card>
        </div>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-medium">Exposed keys</h2>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter findings">
            {filters.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === f.id ? "bg-accent-soft text-accent-strong ring-1 ring-accent/30" : "text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_8rem_5.5rem_1.5rem] gap-4 border-b border-border px-5 py-2 text-xs font-medium text-dim md:grid">
          <span>Key</span>
          <span>Location</span>
          <span>Value</span>
          <span>Exposure</span>
          <span>Severity</span>
          <span />
        </div>
        <ul>
          {shown.map((f) => (
            <li key={f.id} className="border-b border-border last:border-b-0">
              <button
                onClick={() => setOpen(f)}
                className="grid w-full cursor-pointer grid-cols-1 gap-2 px-4 py-4 text-left transition-colors hover:bg-surface-2/60 sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_8rem_5.5rem_1.5rem] md:items-center md:gap-4"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <ProviderMark provider={f.provider} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{f.title}</span>
                    <span className="block truncate text-xs text-muted">{f.whatItCanDo}</span>
                  </span>
                </span>
                <span className="truncate font-mono text-xs text-accent-strong">
                  {f.file}:{f.line}
                </span>
                <span className="truncate font-mono text-xs text-muted">{f.masked}</span>
                <span className="flex items-center gap-3 md:block">
                  <ExposureBadge exposure={f.exposure} />
                  <span className="md:hidden">
                    <SeverityBadge severity={f.severity} />
                  </span>
                </span>
                <span className="hidden md:block">
                  <SeverityBadge severity={f.severity} />
                </span>
                <ChevronRight className="hidden size-4 text-dim md:block" aria-hidden />
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted">Nothing in this category.</li>}
        </ul>
      </Card>

      <IgnoredNote ignored={result.ignored} className="mt-4" />

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-muted">
            <span className="font-medium text-text">{result.findings.length} exposed {result.findings.length === 1 ? "key" : "keys"}</span>
            {" · "}
            {result.plan.changes.length} files will be updated. You&apos;ll preview everything first.
          </p>
          <Button size="lg" onClick={onSecure}>
            Secure my project
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {open && <FindingDrawer finding={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
