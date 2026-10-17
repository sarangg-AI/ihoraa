"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileArchive, FolderOpen, Lock, ScanSearch, ShieldCheck, Sparkles, Upload, WandSparkles } from "lucide-react";
import { Button, Card, cn } from "./ui";

export function UploadView({
  onZip,
  onFiles,
  onDrop,
  onDemo,
  error,
}: {
  onZip: (file: File) => void;
  onFiles: (files: File[]) => void;
  onDrop: (items: DataTransferItemList) => void;
  onDemo: () => void;
  error?: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.items?.length) onDrop(e.dataTransfer.items);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <section className="pt-12 pb-10 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface/80 px-3 py-1 text-xs font-medium text-muted">
          <Sparkles className="size-3.5 text-accent" aria-hidden />
          Security for vibe coders
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          Find leaked API keys.{" "}
          <span className="bg-linear-to-r from-accent-strong to-[#a78bfa] bg-clip-text text-transparent">Fix them in one click.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted text-pretty sm:text-lg">
          Drop your project below. Ihoraa finds every exposed key, moves it somewhere safe and tells you exactly what to do next. No coding needed.
        </p>
      </section>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "relative overflow-hidden rounded-2xl border-2 border-dashed p-8 text-center transition-colors sm:p-12",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-bg-elev/80 hover:border-accent/60",
        )}
      >
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-border-strong bg-surface shadow-lg">
            <Upload className={cn("size-7 transition-transform", dragging ? "-translate-y-1 text-accent" : "text-muted")} aria-hidden />
          </div>
          <p className="mt-5 text-lg font-medium">{dragging ? "Drop it here" : "Drag your project folder or .zip here"}</p>
          <p className="mt-1 text-sm text-muted">Works with code from Lovable, Bolt, Cursor, Replit, v0 and more</p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" onClick={() => zipInput.current?.click()}>
              <FileArchive className="size-4" aria-hidden />
              Choose a .zip file
            </Button>
            <Button size="lg" variant="secondary" onClick={() => folderInput.current?.click()}>
              <FolderOpen className="size-4" aria-hidden />
              Choose a folder
            </Button>
          </div>
          <button onClick={onDemo} className="mt-5 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline">
            <WandSparkles className="size-4" aria-hidden />
            No project handy? Try a demo app
          </button>

          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onZip(file);
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            className="hidden"
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) onFiles(files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-dim">
        <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden /> Never stored. Scanned in memory, then discarded.</span>
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden /> Keys are masked on screen</span>
      </div>

      <section className="mt-16 grid gap-4 pb-20 sm:grid-cols-3">
        {[
          { icon: Upload, title: "1. Upload", text: "Drop a folder or .zip. We skip node_modules and other heavy folders automatically." },
          { icon: ScanSearch, title: "2. Scan", text: "We check every file for 19 kinds of keys, from OpenAI to Stripe, AWS and Supabase." },
          { icon: ShieldCheck, title: "3. Secure", text: "One click moves keys into a private .env file and rewrites your code to use it." },
        ].map(({ icon: Icon, title, text }) => (
          <Card key={title} className="p-5">
            <Icon className="size-5 text-accent" aria-hidden />
            <h3 className="mt-3 font-medium">{title}</h3>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
