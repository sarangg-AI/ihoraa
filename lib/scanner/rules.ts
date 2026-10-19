import type { Confidence, Severity } from "../types";

// Detection rules. Patterns are adapted from the Gitleaks ruleset (MIT licensed)
// and simplified for readability. Each pattern must be global and either expose
// a `secret` named group or match the secret as a whole.

export interface Rule {
  id: string;
  provider: string;
  title: string;
  pattern: RegExp;
  severity: Severity;
  /** Defaults to "high": provider rules match an exact key format. */
  confidence?: Confidence;
  whatItCanDo: string;
  envName: string;
  rotateUrl?: string;
  /** Key type meant for browsers. We still flag it so the user restricts it. */
  publicByDesign?: boolean;
  /** Extra check on the matched secret, e.g. decode a JWT. */
  validate?: (secret: string) => boolean;
}

function jwtRole(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : undefined;
  } catch {
    return undefined;
  }
}

export const RULES: Rule[] = [
  {
    id: "anthropic-api-key",
    provider: "Anthropic",
    title: "Anthropic API key",
    pattern: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{32,}/g,
    severity: "critical",
    whatItCanDo: "Anyone with this key can run Claude requests billed to your account.",
    envName: "ANTHROPIC_API_KEY",
    rotateUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai-api-key",
    provider: "OpenAI",
    title: "OpenAI API key",
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/g,
    severity: "critical",
    whatItCanDo: "Anyone with this key can run AI requests billed to your OpenAI account.",
    envName: "OPENAI_API_KEY",
    rotateUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "stripe-secret-key",
    provider: "Stripe",
    title: "Stripe live secret key",
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
    severity: "critical",
    whatItCanDo: "Anyone with this key can issue refunds, read customer data and move money in your Stripe account.",
    envName: "STRIPE_SECRET_KEY",
    rotateUrl: "https://dashboard.stripe.com/apikeys",
  },
  {
    id: "stripe-test-key",
    provider: "Stripe",
    title: "Stripe test secret key",
    pattern: /\b(?:sk|rk)_test_[A-Za-z0-9]{20,}/g,
    severity: "medium",
    whatItCanDo: "Test-mode only, so no real money. Still gives full access to your Stripe test data.",
    envName: "STRIPE_SECRET_KEY",
    rotateUrl: "https://dashboard.stripe.com/test/apikeys",
  },
  {
    id: "aws-access-key-id",
    provider: "AWS",
    title: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    severity: "critical",
    whatItCanDo: "Together with its secret, this key can control your AWS servers, storage and billing.",
    envName: "AWS_ACCESS_KEY_ID",
    rotateUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
  },
  {
    id: "aws-secret-access-key",
    provider: "AWS",
    title: "AWS secret access key",
    pattern: /aws[A-Za-z0-9_]{0,20}?(?:secret|SECRET)[A-Za-z0-9_]{0,20}\s*[:=]\s*['"`]?(?<secret>[A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
    severity: "critical",
    whatItCanDo: "This is the password half of an AWS key. It can control your AWS account.",
    envName: "AWS_SECRET_ACCESS_KEY",
    rotateUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
  },
  {
    id: "github-token",
    provider: "GitHub",
    title: "GitHub access token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/g,
    severity: "critical",
    whatItCanDo: "Anyone with this token can read or change your code repositories.",
    envName: "GITHUB_TOKEN",
    rotateUrl: "https://github.com/settings/tokens",
  },
  {
    id: "supabase-service-role",
    provider: "Supabase",
    title: "Supabase service-role key",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    severity: "critical",
    whatItCanDo: "This key bypasses all database security rules. Anyone can read, change or delete every row.",
    envName: "SUPABASE_SERVICE_ROLE_KEY",
    rotateUrl: "https://supabase.com/dashboard/project/_/settings/api-keys",
    validate: (secret) => jwtRole(secret) === "service_role",
  },
  {
    id: "supabase-secret-key",
    provider: "Supabase",
    title: "Supabase secret key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
    severity: "critical",
    whatItCanDo: "This key bypasses all database security rules. Anyone can read, change or delete every row.",
    envName: "SUPABASE_SECRET_KEY",
    rotateUrl: "https://supabase.com/dashboard/project/_/settings/api-keys",
  },
  {
    id: "google-api-key",
    provider: "Google",
    title: "Google / Firebase API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "medium",
    whatItCanDo:
      "Often meant for browsers (Firebase, Maps), but an unrestricted key can be used by anyone to run up your Google Cloud bill.",
    envName: "GOOGLE_API_KEY",
    rotateUrl: "https://console.cloud.google.com/apis/credentials",
    publicByDesign: true,
  },
  {
    id: "slack-token",
    provider: "Slack",
    title: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    severity: "high",
    whatItCanDo: "Anyone with this token can read and post messages in your Slack workspace.",
    envName: "SLACK_TOKEN",
    rotateUrl: "https://api.slack.com/apps",
  },
  {
    id: "sendgrid-api-key",
    provider: "SendGrid",
    title: "SendGrid API key",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    severity: "high",
    whatItCanDo: "Anyone with this key can send emails as you, including spam and phishing.",
    envName: "SENDGRID_API_KEY",
    rotateUrl: "https://app.sendgrid.com/settings/api_keys",
  },
  {
    id: "twilio-api-key",
    provider: "Twilio",
    title: "Twilio API key",
    pattern: /\bSK[0-9a-fA-F]{32}\b/g,
    severity: "high",
    whatItCanDo: "Anyone with this key can send texts and make calls billed to your Twilio account.",
    envName: "TWILIO_API_KEY",
    rotateUrl: "https://console.twilio.com/us1/account/keys-credentials/api-keys",
  },
  {
    id: "mailgun-api-key",
    provider: "Mailgun",
    title: "Mailgun API key",
    pattern: /\bkey-[0-9a-zA-Z]{32}\b/g,
    severity: "high",
    whatItCanDo: "Anyone with this key can send emails from your domain.",
    envName: "MAILGUN_API_KEY",
    rotateUrl: "https://app.mailgun.com/settings/api_security",
  },
  {
    id: "huggingface-token",
    provider: "Hugging Face",
    title: "Hugging Face token",
    pattern: /\bhf_[A-Za-z0-9]{34,}\b/g,
    severity: "high",
    whatItCanDo: "Anyone with this token can use your Hugging Face account, models and paid inference.",
    envName: "HF_TOKEN",
    rotateUrl: "https://huggingface.co/settings/tokens",
  },
  {
    id: "groq-api-key",
    provider: "Groq",
    title: "Groq API key",
    pattern: /\bgsk_[A-Za-z0-9]{40,}\b/g,
    severity: "critical",
    whatItCanDo: "Anyone with this key can run AI requests billed to your Groq account.",
    envName: "GROQ_API_KEY",
    rotateUrl: "https://console.groq.com/keys",
  },
  {
    id: "replicate-api-token",
    provider: "Replicate",
    title: "Replicate API token",
    pattern: /\br8_[A-Za-z0-9]{37}\b/g,
    severity: "critical",
    whatItCanDo: "Anyone with this token can run AI models billed to your Replicate account.",
    envName: "REPLICATE_API_TOKEN",
    rotateUrl: "https://replicate.com/account/api-tokens",
  },
  {
    id: "private-key",
    provider: "Private key",
    title: "Private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]{20,}?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    severity: "critical",
    whatItCanDo: "A private key proves identity. Anyone with it can impersonate your server, app or account.",
    envName: "PRIVATE_KEY",
  },
  {
    id: "database-url",
    provider: "Database",
    title: "Database URL with password",
    pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^:\s'"`/@]+:[^@\s'"`]+@(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|mysql|redis|mongo)(?:[:/]|$))[^\s'"`]+/g,
    severity: "critical",
    whatItCanDo: "This contains your database password. Anyone with it can read or wipe your data.",
    envName: "DATABASE_URL",
  },
];

/** Names that suggest a value is a secret, used by the generic entropy check. */
export const SECRET_NAME =
  /(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key|auth[_-]?key|client[_-]?secret|credentials?)/i;
