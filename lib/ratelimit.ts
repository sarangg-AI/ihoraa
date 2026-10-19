// Best-effort limit on how often one IP address can call the API. Counts live in
// this server instance's memory only (never stored, gone after the window), so
// it stops one person hammering the service but is not a hard global cap: each
// instance counts separately. The privacy page describes this behaviour.

export const RATE_LIMIT_WINDOW_MINUTES = 10;
const WINDOW_MS = RATE_LIMIT_WINDOW_MINUTES * 60_000;
/** Scanning one project takes 2–3 requests (scan, then one download per try). */
export const RATE_LIMIT_MAX_REQUESTS = 30;
/** Upper bound on tracked addresses so memory use stays small. */
const MAX_TRACKED = 10_000;

const hits = new Map<string, number[]>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  recent.push(now);
  hits.delete(key); // re-insert so the Map stays ordered by last use
  hits.set(key, recent);
  if (hits.size > MAX_TRACKED) hits.delete(hits.keys().next().value!);
  return { ok: true };
}

/** The caller's IP address. On Vercel these headers are set by the platform, not the client. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? forwarded ?? "unknown";
}

/** 429 response with a plain-English message, or null when the request may go ahead. */
export function rateLimited(request: Request): Response | null {
  const result = checkRateLimit(clientKey(request));
  if (result.ok) return null;
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return Response.json(
    { error: `You've run a lot of scans in a short time. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.` },
    { status: 429, headers: { "retry-after": String(result.retryAfterSeconds), "cache-control": "no-store" } },
  );
}

/** Test helper. */
export function resetRateLimit(): void {
  hits.clear();
}
