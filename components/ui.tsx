import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FileKey, Globe, Server, FileCode } from "lucide-react";
import type { Exposure, Severity } from "@/lib/types";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        variant === "primary" && "bg-accent text-white hover:bg-accent-strong shadow-[0_0_0_1px_rgb(255_255_255/0.08)_inset,0_8px_24px_-8px_rgb(91_140_255/0.6)]",
        variant === "secondary" && "border border-border-strong bg-surface text-text hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:text-text hover:bg-surface",
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-surface/70 backdrop-blur-sm", className)}>{children}</div>;
}

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "bg-critical-soft text-critical ring-critical/30",
  high: "bg-danger-soft text-danger ring-danger/25",
  medium: "bg-warn-soft text-warn ring-warn/25",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset", SEVERITY_STYLE[severity])}>
      {severity}
    </span>
  );
}

export const EXPOSURE_INFO: Record<Exposure, { label: string; icon: typeof Globe; className: string; help: string }> = {
  frontend: {
    label: "Visible in browser",
    icon: Globe,
    className: "text-critical",
    help: "This code is sent to every visitor's browser. Anyone can open DevTools and copy the key.",
  },
  server: {
    label: "Server code",
    icon: Server,
    className: "text-muted",
    help: "Visitors can't see this code, but the key is saved in your files and in GitHub.",
  },
  "env-file": {
    label: "Unprotected .env",
    icon: FileKey,
    className: "text-warn",
    help: "Your .env file isn't in .gitignore, so it gets uploaded with your code.",
  },
  config: {
    label: "Config / docs",
    icon: FileCode,
    className: "text-muted",
    help: "A config or documentation file that is shared along with your code.",
  },
};

export function ExposureBadge({ exposure }: { exposure: Exposure }) {
  const info = EXPOSURE_INFO[exposure];
  const Icon = info.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", info.className)}>
      <Icon className="size-3.5" aria-hidden />
      {info.label}
    </span>
  );
}

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "#10a37f",
  Anthropic: "#d97757",
  Stripe: "#635bff",
  AWS: "#ff9900",
  GitHub: "#8b949e",
  Supabase: "#3ecf8e",
  Google: "#4285f4",
  Slack: "#e01e5a",
  SendGrid: "#1a82e2",
  Twilio: "#f22f46",
  Mailgun: "#c02126",
  "Hugging Face": "#ffcc4d",
  Groq: "#f55036",
  Replicate: "#a0a0a0",
  Database: "#38bdf8",
  "Private key": "#c084fc",
};

export function ProviderMark({ provider, size = "md" }: { provider: string; size?: "sm" | "md" }) {
  const color = PROVIDER_COLORS[provider] ?? "#8b97ad";
  const initials = provider === "Hugging Face" ? "HF" : provider === "Private key" ? "PK" : provider.slice(0, 2);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold",
        size === "md" ? "size-9 text-xs" : "size-7 text-[10px]",
      )}
      style={{ background: `${color}1f`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}
    >
      {initials}
    </span>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-accent to-[#7c3aed] shadow-[0_8px_24px_-8px_rgb(91_140_255/0.8)]">
        <svg viewBox="0 0 24 24" className="size-[18px] text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" />
          <circle cx="12" cy="11" r="2" />
          <path d="M12 13v3" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight">ihoraa</span>
    </span>
  );
}
