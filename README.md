# Shelfmark: bookmark research assistant

Save public web pages or pasted text, rediscover them with loose wording (**Find**), and ask questions answered only from your saved passages, with citations that open the exact supporting text (**Ask**).

- Product scope: [PRODUCT.md](PRODUCT.md) · Interface: [DESIGN.md](DESIGN.md)
- Data model and pipeline: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Endpoints: [docs/API.md](docs/API.md)
- Evaluation set and observed results: [docs/EVALUATION.md](docs/EVALUATION.md)
- The previous Vite placeholder is preserved in [`legacy-starter/`](legacy-starter/) and is not part of the app.

Stack: Next.js 16 (App Router, route handlers), TypeScript, PostgreSQL + pgvector (embedded PGlite locally), Vercel AI SDK 7 — Google Gemini by default, Vercel AI Gateway as an alternative provider.

## Prerequisites

- **Node.js 22.18 or newer**: `npm run db:migrate` runs a `.ts` file with Node's built-in type stripping. Developed on Node 26.8.
- npm (versions are pinned in `package-lock.json`).
- Optional: a **Gemini API key** from https://aistudio.google.com/apikey (free tier available, no card needed). Without it, the app still saves, indexes (keyword-only) and runs Find, but Ask returns `503 ai_unavailable` along with the passages it would have used. A **Vercel AI Gateway key** works instead if you prefer that provider.
- Optional: a PostgreSQL 15+ database with the `vector` extension available. Without `DATABASE_URL`, the app uses embedded PGlite and needs no database server.

## Setup

```bash
npm install
cp .env.example .env.local        # then edit .env.local
npm run db:migrate                # optional: migrations also run automatically on first request
npm run dev                       # http://localhost:3000
```

Open http://localhost:3000, create an account on the sign-in page, and use **Save** to add a URL or pasted text.

## Environment variables

Set in `.env.local` (git-ignored). Next.js loads it automatically, and `npm run db:migrate` loads it via `--env-file-if-exists`.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | no | unset | Gemini key. Enables embeddings (`gemini-embedding-001`, 1536 dims) and answer generation. Server-only, never sent to the browser. `GEMINI_API_KEY` is also accepted. |
| `AI_GATEWAY_API_KEY` | no | unset | Alternative provider, used only when no Gemini key is set. On Vercel, `VERCEL_OIDC_TOKEN` also works. |
| `AI_MODEL` | no | `gemini-3.5-flash-lite` (or `openai/gpt-5.4-mini` on the gateway) | Chat model used for Ask answers. |
| `DATABASE_URL` | no | unset | PostgreSQL connection string. When set, PGlite is not used. |
| `PGLITE_DIR` | no | `./.data/pglite` | Where the embedded database is stored when `DATABASE_URL` is unset. |

## Database migrations

SQL migrations live in `db/migrations/` and are applied in filename order. Applied versions are recorded in `schema_migrations`.

- They run automatically the first time the server touches the database.
- `npm run db:migrate` applies them explicitly (use it in deploy pipelines against `DATABASE_URL`).
- The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`. On managed Postgres, the role needs permission to create it, or an admin must enable it first.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build / serve it |
| `npm test` | Vitest suite (chunking, URL safety, retrieval on real PGlite + pgvector, RAG prompt/validation with a mocked model, ownership, processing) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply pending migrations |
| `BASE_URL=http://localhost:3000 node eval/run.mjs` | Evaluation harness (needs a running server) → `.data/evidence/eval-results.json` |
| `node scripts/screenshots.mjs` | Desktop + mobile screenshots (needs a running server and `npx playwright install chromium`) → `.data/evidence/screens/` |
| `node scripts/e2e-flows.mjs` | End-to-end API checks for persistence, failure/retry, delete and isolation (needs a running server) → `.data/evidence/e2e-flows.txt` |

The eval, screenshot and e2e scripts create throwaway accounts with clearly labelled test content in whichever database the server uses.

## Troubleshooting

- **Ask says "AI is not configured"**: neither `GOOGLE_GENERATIVE_AI_API_KEY` nor `AI_GATEWAY_API_KEY` is set. Add one to `.env.local` and restart `npm run dev`. If a key is set but Ask still returns 503, the provider call failed (wrong key, model id or quota); the server log shows `[shelfmark] AI request failed`.
- **The key works but AI calls fail with `customer_verification_required`**: Vercel requires a credit card on file to unlock even the free monthly AI Gateway credits — add one at https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai. No purchase is needed. Until then, saving and keyword Find keep working (bookmarks just index without embeddings).
- **Find says meaning-based matching is off**: same cause. Bookmarks saved before a key was added only have keyword passages. Re-process them with `POST /api/bookmarks/:id/retry` (the UI offers Retry only for failed items) or save them again.
- **A URL ends in "failed"**: the message explains why. Private/loopback/metadata addresses, non-80/443 ports, logins/paywalls (401/402/403), non-HTML content, pages over 3 MB, more than 5 redirects, and fetches over 10 s are all refused. Pages with under 200 characters of readable text also fail. Open the bookmark and use **Paste text** to supply the content yourself; the app never bypasses access restrictions.
- **Bookmarks stuck in "pending" or "processing"**: jobs run in the server process. If it restarted mid-job, loading the library re-queues pending items older than 1 minute and processing items older than 5 minutes.
- **`db:migrate` hangs or errors with PGlite while the dev server runs**: PGlite is single-process. Stop `npm run dev` first, or skip the command, since the server migrates on start.
- **Port 3000 already in use**: another `next dev` is running. Stop it, or run `npx next dev -p 3001`.
- **Reset local data**: stop the server and delete the `.data/pglite` directory. This erases all local accounts and bookmarks.

## Deployment (prepared, not performed)

Public deployment and paid resources need explicit authorization; nothing has been deployed. When approved, deploy to Vercel:

1. Provision PostgreSQL with pgvector (e.g. Neon via the Vercel Marketplace) and set `DATABASE_URL`.
2. Set `GOOGLE_GENERATIVE_AI_API_KEY` (or `AI_GATEWAY_API_KEY` / Vercel OIDC for the gateway) and optionally `AI_MODEL`.
3. Run `npm run db:migrate` once against the production database, or let the first request apply migrations.
4. `vercel deploy`, then sign up and save a test page on the preview URL.

Production caveats (documented `shortcut:` comments in the code):

- **Background processing is in-process** (`lib/jobs.ts`): a bounded queue (concurrency 2) kept alive with Next's `after()`. That is acceptable for a single instance; for multi-instance or long-running ingestion, move it to a durable queue (e.g. Vercel Queues or Workflow). Stale jobs are re-queued when the library loads.
- **Login rate limiting is in memory** (`lib/auth.ts`): per instance only. Use Redis or the database for a shared limit.
- Embedded PGlite is for local use only. Serverless deployments must use `DATABASE_URL`.

## Known limitations

See [docs/EVALUATION.md](docs/EVALUATION.md) for details. In short: semantic retrieval and answer generation are verified live against Gemini; the keyword branch can still retrieve a passage on a single incidental shared word, so loosely related sources occasionally appear in results and prompts. Deferred features (browser extension, social-media imports, video transcription, autonomous browsing) are listed in [PRODUCT.md](PRODUCT.md).
