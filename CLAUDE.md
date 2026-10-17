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
- **Placeholders:** `isPlaceholder` treats masked bullets (`•`) and `IHORAA_` markers as placeholders. That is why a fixed project scans clean.

**Fixer (`lib/fixer/index.ts`)** picks one strategy per finding:
- **`.env` findings:** no code edit; `.gitignore` is updated.
- **Secret key in browser code:** replaced with `IHORAA_KEY_MOVED_TO_SERVER`, plus a TODO comment, a manual step with an AI-tool prompt, and, for providers in `PROXY_PROVIDERS` (`proxy.ts`), a generated proxy route. Proxies are limited on purpose to AI APIs with an endpoint allow-list.
- **Everything else:** `replaceWithExpression` (`literal.ts`) swaps the enclosing string literal for a per-language env lookup (`language.ts`). Browser-safe keys get a framework public prefix. If no safe rewrite exists, the value becomes `IHORAA_MOVED_TO_ENV_<NAME>` and a manual step is added.

All changes are `Edit` objects applied bottom-up. `pushEdit` rejects overlapping edits.

**UI.** `app/page.tsx` renders one client component, `components/IhoraaApp.tsx`, a step state machine (upload → scanning → results → fix). There are no `/results` or `/fix` routes.
- Styling is Tailwind v4, dark-only.
- Design tokens live in `app/globals.css` under `@theme`: `bg-surface`, `text-muted`, `text-critical`, …
- Shared primitives are in `components/ui.tsx`. There is no shadcn.

## Tests

`tests/fixer.test.ts` → "leaves no findings when the fixed project is scanned again" is the main regression guard. Keep it passing when changing rules, masking or fixer output.

Fake keys in `tests/fakes.ts` and `lib/client/demo.ts` are built by concatenation at runtime. Never write realistic key literals into the repo: GitHub push protection would block the push.
