# Ihoraa

Security for vibe coders. Upload a project, find exposed API keys and secure them in one click.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and click **Try a demo app** to see the full flow without your own code.

```bash
npm test        # scanner + fixer unit tests
npm run build   # production build
```

## How it works

1. **Upload** (`components/UploadView.tsx`, `lib/client/project.ts`): drag and drop a folder or `.zip`. Files are read in the browser. `node_modules`, `.git`, build folders, lockfiles and binaries are skipped, and only text files go to the server.
2. **Scan** (`POST /api/scan` → `lib/scanner/`): regex rules based on Gitleaks cover 19 key types (OpenAI, Anthropic, Stripe, AWS, Supabase, GitHub, Google…). An entropy check catches generic secrets. Each finding is classified as *visible in browser*, *server code*, *unprotected .env* or *config*. Raw secrets never leave the server: the UI only gets masked values.
3. **Fix** (`lib/fixer/`): every fix is previewed as a masked diff first.
   - Server code: the literal becomes an env lookup (`process.env.X`, `os.environ["X"]`…) and the value moves into `.env`.
   - Browser code with secret keys: the key is removed. For OpenAI, Anthropic and Groq, a locked-down proxy route is generated. Every case gets a ready-to-paste prompt for the user's AI coding tool.
   - Browser-safe keys (Google/Firebase): moved to `NEXT_PUBLIC_` / `VITE_` variables, plus advice to restrict them.
   - `.env`, `.env.example` and `.gitignore` are created or updated, and an `IHORAA_REPORT.md` is added.
4. **Download** (`POST /api/fix`): the server returns the changed files. The browser merges them with the original upload into `<project>-secured.zip`. Then the user works through the key-rotation checklist.

Nothing is stored. Both API routes are stateless and process uploads in memory.

## Limits of this prototype

- Exposure detection is heuristic (paths, `"use client"`, framework).
- Browser code that called an API directly still needs one manual change to use the generated proxy. The UI gives the user a prompt for their AI tool.
- Moving a key does not un-leak it. Users must rotate every key that was found.
