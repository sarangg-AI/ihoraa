"use client";

import { Check, LoaderCircle } from "lucide-react";
import { Card, cn } from "./ui";

export type ScanPhase = "reading" | "scanning" | "preparing";

const PHASES: { id: ScanPhase; label: string }[] = [
  { id: "reading", label: "Reading your files" },
  { id: "scanning", label: "Looking for exposed keys" },
  { id: "preparing", label: "Preparing fixes" },
];

export function ScanningView({ phase, read, total, projectName }: { phase: ScanPhase; read: number; total: number; projectName?: string }) {
  const current = PHASES.findIndex((p) => p.id === phase);
  const pct = phase === "reading" && total > 0 ? Math.round((read / total) * 100) : phase === "reading" ? 5 : phase === "scanning" ? 75 : 95;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-20">
      <Card className="w-full overflow-hidden p-8">
        <div className="relative mx-auto mb-6 h-24 w-20 overflow-hidden rounded-lg border border-border-strong bg-bg-elev">
          <div className="space-y-2 p-3" aria-hidden>
            {[70, 90, 55, 80, 65, 85].map((w, i) => (
              <div key={i} className="h-1.5 rounded-full bg-border-strong" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="animate-scan-line absolute inset-x-0 top-0 h-6 bg-linear-to-b from-transparent via-accent/40 to-transparent" aria-hidden />
        </div>

        <h2 className="text-center text-xl font-semibold">Scanning {projectName ?? "your project"}</h2>
        <p className="mt-1 text-center text-sm text-muted" aria-live="polite">
          {phase === "reading" && total > 0 ? `${read.toLocaleString()} of ${total.toLocaleString()} files read` : "This only takes a few seconds"}
        </p>

        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>

        <ol className="mt-6 space-y-3">
          {PHASES.map((p, i) => (
            <li key={p.id} className={cn("flex items-center gap-3 text-sm", i > current ? "text-dim" : "text-text")}>
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full",
                  i < current && "bg-ok-soft text-ok",
                  i === current && "text-accent",
                  i > current && "border border-border-strong",
                )}
              >
                {i < current ? <Check className="size-3" aria-hidden /> : i === current ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              </span>
              {p.label}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
