import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { RATE_LIMIT_WINDOW_MINUTES } from "@/lib/ratelimit";

export const metadata: Metadata = {
  title: "Privacy · Ihoraa",
  description: "What happens to the code you upload to Ihoraa: scanned in memory, never stored, never run.",
};

// Keep this page in sync with the code. Every statement here describes how the
// upload, scan and fix flow actually behaves (see CLAUDE.md, "Request flow").

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <div className="mt-3 space-y-3 text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Ihoraa home">
            <Logo />
          </Link>
          <Link href="/" className="text-xs font-medium text-muted hover:text-text">
            Scan a project
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 leading-relaxed sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p className="mt-2 text-sm text-dim">Last updated 19 October 2026</p>

        <p className="mt-8 rounded-xl border border-border bg-surface/70 p-5 text-text">
          <strong>The short version:</strong> your code is checked in memory and thrown away as soon as the check is done. We
          don&apos;t save it, we never run it, and we don&apos;t use it for anything else.
        </p>

        <Section title="What we receive">
          <p>
            When you choose a .zip file or a folder, your browser opens it on your own device. It skips heavy folders like{" "}
            <code className="font-mono text-text">node_modules</code>, as well as images and other non-text files. Only your
            text files (code and settings) are sent to our server. Everything else stays on your computer.
          </p>
        </Section>

        <Section title="What happens on our server">
          <ul className="list-disc space-y-2 pl-5">
            <li>Your files are scanned in memory while your request is being handled, then discarded.</li>
            <li>They are not saved to disk, not stored in a database and not written to our logs.</li>
            <li>Your code is never run, installed or executed. We only read it as text.</li>
            <li>Your code is not shared, not sold and not used to train AI models.</li>
          </ul>
        </Section>

        <Section title="Your keys">
          <p>
            Scan results show every key masked, for example <code className="font-mono text-text">sk-••••3fA9</code>. The
            full key is never sent to your screen.
          </p>
          <p>
            When you download the secured project, your files are sent once more. Our server sends back the changed files,
            including a <code className="font-mono text-text">.env</code> file that holds your real keys. This happens over
            an encrypted connection (HTTPS), and the response is never cached. The secured .zip is put together in your
            browser.
          </p>
        </Section>

        <Section title="What our hosting provider sees">
          <p>
            Ihoraa runs on Vercel. Like any web host, Vercel keeps standard request logs for a limited time: when a request
            happened, which page it was for, your IP address and your browser type. These logs do not contain your files.
            See{" "}
            <a href="https://vercel.com/legal/privacy-policy" className="text-accent-strong hover:underline" rel="noreferrer" target="_blank">
              Vercel&apos;s privacy policy
            </a>
            .
          </p>
        </Section>

        <Section title="Protection against abuse">
          <p>
            To stop one person from overloading the service, we count how many scans come from each IP address. The count
            is kept only in server memory, is never saved and is forgotten after about {RATE_LIMIT_WINDOW_MINUTES} minutes.
          </p>
        </Section>

        <Section title="No accounts, no tracking">
          <p>There is no sign-up, no advertising and no analytics or tracking cookies.</p>
        </Section>

        <Section title="One important reminder">
          <p>
            Moving a key out of your code does not make it safe again. If a key was ever in your code or on GitHub, replace
            it with a new one in the provider&apos;s dashboard. Ihoraa gives you a checklist for this after securing your
            project.
          </p>
        </Section>
      </main>
    </div>
  );
}
