# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Ihoraa is a security tool for vibe coders. Users upload a project, Ihoraa finds exposed API keys, previews a fix and returns a secured copy as a zip.

## Commands

```bash
npm run dev                                       # dev server on :3000 (Turbopack)
npm test                                          # all vitest tests
npx vitest run tests/scanner.test.ts              # one file
npx vitest run -t "removes AI keys from browser"  # one test by name
npm run benchmark                                 # accuracy scorecard (tests/corpus.ts)
npm run lint
npx tsc --noEmit                                  # if it reports stale errors, delete tsconfig.tsbuildinfo
npm run build
```

The browser-pane launch config lives one level up, in `../.claude/launch.json` (configuration `ihoraa-dev`).

## Next.js version

This is Next.js 16 with `cacheComponents` and `partialPrefetching` turned on (see `AGENTS.md`). Check `node_modules/next/dist/docs/` before using framework APIs.
- Route handlers must not export `runtime`.
- `tsconfig` targets ES2022 because the scanner relies on regex named groups and the `d` (indices) flag.

## Architecture

**Request flow (stateless):**
1. `lib/client/project.ts` reads a zip or folder in the browser. It filters files with `lib/scanner/walk.ts`, which is shared by client and server, and keeps every entry in memory.
2. The browser POSTs only the scannable text files to `/api/scan`.
3. `lib/analyze.ts` runs `scanFiles` (`lib/scanner/`) and then `buildFix` (`lib/fixer/`). It returns a `ScanResult` with masked findings and the full fix preview (diffs, manual steps, rotations).
4. `/api/fix` gets the same files, runs `analyze` again and returns the full contents of the changed and added files. This response includes the real `.env`.
5. `buildSecuredZip` merges those files with the original upload, binaries included.

There is no server-side store, so scan and fix must stay deterministic for the same input.

**Limits.**
- Uploads are capped at `MAX_UPLOAD_BYTES` (4 MB, `lib/scanner/walk.ts`), because Vercel rejects request bodies over 4.5 MB. The browser checks this before sending and the server checks it again.
- Both API routes call `rateLimited` (`lib/ratelimit.ts`): 30 requests per IP per 10 minutes. Counts are kept in memory for each server instance, so this is a best-effort limit, not a hard one.

**Privacy page.** `app/privacy/page.tsx` describes this flow in plain English. Update it whenever upload, storage, logging or rate-limit behaviour changes.

**Secret-handling invariant.** `RawFinding` (in `lib/types.ts`) carries `secret` and offsets and must never reach the browser. Only these leave the server:
- `toPublic` output (`lib/analyze.ts`)
- diffs masked by `maskAll` (`lib/fixer/diff.ts`)
- snippets masked by `maskRanges`

A test asserts that the serialized result never contains the raw key.

**Scanner (`lib/scanner/`):**
- **Rules** live in `rules.ts`. A rule either exposes a `secret` named group or matches the whole secret. Overlapping matches go to the first rule, so order matters: Anthropic comes before OpenAI.
- **Generic secrets** are caught by an assignment regex plus an entropy check (`entropy.ts`). `.env` lines have their own pass.
- **`.env` files are scanned first**, so a hard-coded value in code reuses the variable name already in `.env`.
- **A gitignored `.env`** is not reported, except for secrets in public-prefixed variables (`NEXT_PUBLIC_`, `VITE_`, …).
- **Exposure** (`frontend` / `server` / `env-file` / `config`) is a path, directive and framework heuristic in `exposure.ts`. A `frontend` finding is escalated to critical unless the rule is `publicByDesign`.
- **Not-a-secret markers:** a match on a line containing `ihoraa-ignore` or `gitleaks:allow` is not reported. Its location goes into `ScanResult.ignored` instead, and the results screen lists it, so a marker can never hide a leak silently.
- **Placeholders:** `isPlaceholder` treats masked bullets (`•`) and `IHORAA_` markers as placeholders. That is why a fixed project scans clean.

**Fixer (`lib/fixer/index.ts`)** picks one strategy per finding:
- **`.env` findings:** no code edit; `.gitignore` is updated.
- **Keys in comments or docs** (`.md`, `.txt`…): redacted to `IHORAA_MOVED_TO_ENV_<NAME>`, with no manual step.
- **Secret key in browser code:** replaced with `IHORAA_KEY_MOVED_TO_SERVER`, plus a TODO comment, a manual step with an AI-tool prompt, and, for providers in `PROXY_PROVIDERS` (`proxy.ts`), a generated proxy route. Proxies are limited on purpose to AI APIs with an endpoint allow-list.
- **Everything else:** `rewriteLiteral` (`literal.ts`) swaps the enclosing string literal for a per-language env lookup (`language.ts`). Every key in the same literal is rewritten in one edit. Browser-safe keys get a framework public prefix.
- **YAML** can only read variables in GitHub Actions (`${{ secrets.X }}`, never `GITHUB_*` names) and docker-compose (`${X}`). Both quoted and unquoted values are handled.
- **No safe rewrite:** the value becomes `IHORAA_MOVED_TO_ENV_<NAME>` and a manual step is added.

`contextAt` in `literal.ts` is a small per-language lexer that tells code, strings and comments apart. Use it instead of searching for nearby quotes.

All changes are `Edit` objects applied bottom-up. `pushEdit` rejects overlapping edits. A final safety net then replaces any raw key still left in an output file, so nothing leaks even when an edit is dropped.

**UI.** `app/page.tsx` renders one client component, `components/IhoraaApp.tsx`, a step state machine (upload → scanning → results → fix). There are no `/results` or `/fix` routes.
- Styling is Tailwind v4, dark-only.
- Design tokens live in `app/globals.css` under `@theme`: `bg-surface`, `text-muted`, `text-critical`, …
- Shared primitives are in `components/ui.tsx`. There is no shadcn.

## Tests

`tests/fixer.test.ts` → "leaves no findings when the fixed project is scanned again" is the main regression guard. Keep it passing when changing rules, masking or fixer output.

**Accuracy benchmark.** `npm run benchmark` grades the scanner on the labelled samples in `tests/corpus.ts` and prints a scorecard (secrets found, false alarms), showing masked values only. The `BASELINE` in `tests/benchmark.test.ts` is a ratchet: when a scanner change lowers the false-alarm count, lower `BASELINE` to match. The count may never go up. To test a new false-positive or detection idea, add a sample there.

For new fixer cases, use the `expectNoLeak` helper in `tests/fixer.test.ts`. It checks that no raw key survives outside `.env` and that a re-scan is clean. `tests/fixer-paths.test.ts` covers the proxy routes (with a syntax check of the generated code), other languages, private keys and the `.env` helpers.

Fake keys in `tests/fakes.ts` and `lib/client/demo.ts` are built by concatenation at runtime. Never write realistic key literals into the repo: GitHub push protection would block the push.
