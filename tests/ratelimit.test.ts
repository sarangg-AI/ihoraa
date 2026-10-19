import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientKey, RATE_LIMIT_MAX_REQUESTS, rateLimited, resetRateLimit } from "../lib/ratelimit";

beforeEach(resetRateLimit);

describe("rate limit", () => {
  it("allows normal use and blocks the request after the limit", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) expect(checkRateLimit("1.2.3.4", now + i).ok).toBe(true);
    const blocked = checkRateLimit("1.2.3.4", now + RATE_LIMIT_MAX_REQUESTS);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each address separately", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit("1.2.3.4", 0);
    expect(checkRateLimit("1.2.3.4", 0).ok).toBe(false);
    expect(checkRateLimit("5.6.7.8", 0).ok).toBe(true);
  });

  it("forgets old requests after the window", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) checkRateLimit("1.2.3.4", 0);
    expect(checkRateLimit("1.2.3.4", 11 * 60_000).ok).toBe(true);
  });

  it("reads the client address from platform headers", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "8.8.8.8, 10.0.0.1" } }))).toBe("8.8.8.8");
  });

  it("answers with 429 and a plain-English message", async () => {
    const req = () => new Request("http://x", { headers: { "x-real-ip": "7.7.7.7" } });
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) expect(rateLimited(req())).toBeNull();
    const res = rateLimited(req())!;
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await res.json()).error).toMatch(/Please wait about \d+ minutes? and try again/);
  });
});
