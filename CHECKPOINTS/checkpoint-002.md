# CHECKPOINT 002

## Date
2026-09-27

## Session Objective
Build the entire Week 1 Kifayat MVP from scratch: scaffold, persistent memory,
all engine components, API routes, dashboard, database.

## What Was Completed

### Infrastructure
- Next.js 16 (App Router) + TypeScript project scaffolded
- package.json: all dependencies declared (openai, @prisma/client, mathjs, chart.js, tsx)
- @xenova/transformers installed as optional dependency
- npm install completed successfully (494 packages)
- .env.local (placeholder), .env (DATABASE_URL), .env.local.example
- Prisma schema created (prisma/schema.prisma) with QueryRun model
- Initial SQLite migration applied: 20260927173251_init
- dev.db SQLite database created at project root

### Persistent Memory Structure
- PROJECT_CONTEXT.md — permanent architecture + scope doc
- PROJECT_MEMORY.md — engineering decisions (SQLite, Groq, dual scoring, THRIFT reference)
- CURRENT_STATE.md — accurate current state
- CHECKPOINTS/checkpoint-001.md — initial baseline
- CHECKPOINTS/checkpoint-002.md — this file

### Engine (lib/engine/)
- types.ts — all shared TypeScript types (IntentCategory, TierResult, etc.)
- classifier.ts — regex-first + cheap-model-fallback classifier (general-purpose)
- decomposer.ts — conservative split (numbered list / semicolon / "and"+different-intent)
- optimizer.ts — input filler strip + per-intent system prompts + max_tokens caps + post-processing
- confidence.ts — routing heuristic scorer (hedge/refusal/format/length) — clearly documented as NOT accuracy
- cascade.ts — 4-tier cascade with confidence gating + BYOK + free-tier fallback
- reassembler.ts — multi-subtask answer stitching
- scorer.ts — quality-preservation score (cosine similarity + word-overlap fallback)
- pipeline.ts — main orchestrator (optimized + naive run)
- lib/db.ts — Prisma singleton

### API Routes
- app/api/optimize/route.ts — POST /api/optimize
- app/api/compare/route.ts — POST /api/compare (parallel naive + optimized, DB persist)
- app/api/runs/route.ts — GET /api/runs (paginated + aggregates)

### Frontend
- app/globals.css — dark-mode CSS design system (glassmorphism, gradients, animations)
- app/layout.tsx — root layout with Inter + JetBrains Mono fonts
- app/page.tsx — full dashboard (hero, aggregate stats, compare form, BYOK toggle,
  results panels, quality score bar, Chart.js chart, run history table)

### Other
- scripts/eval.ts — benchmark eval script (18 prompts across all categories)
- README.md — full documentation

## What Changed
### Files Created
- PROJECT_CONTEXT.md, PROJECT_MEMORY.md, CURRENT_STATE.md
- CHECKPOINTS/checkpoint-001.md, CHECKPOINTS/checkpoint-002.md
- prisma/schema.prisma, prisma/migrations/ (auto-generated)
- lib/engine/types.ts, classifier.ts, decomposer.ts, optimizer.ts,
  confidence.ts, cascade.ts, reassembler.ts, scorer.ts, pipeline.ts
- lib/db.ts
- app/api/optimize/route.ts, app/api/compare/route.ts, app/api/runs/route.ts
- app/globals.css (replaced default), app/layout.tsx (replaced), app/page.tsx (replaced)
- scripts/eval.ts
- README.md
- .env, .env.local, .env.local.example
- package.json (updated)

### Files Modified
- package.json (name, scripts, dependencies)
- app/globals.css (completely replaced)
- app/layout.tsx (completely replaced)
- app/page.tsx (completely replaced)
- README.md (completely replaced)

## Architecture Changes
Complete end-to-end pipeline implemented:
```
User Prompt → Decomposer → Classifier → Optimizer → Cascade (T0/T1/T2/T3)
  → Reassembler → Scorer → DB → Dashboard
```

## Important Implementation Details

### Key engineering decisions (all in PROJECT_MEMORY.md):
1. @xenova/transformers installed as `optionalDependencies` — native build can fail
   on Windows (sharp/libvips). scorer.ts has word-overlap fallback when it fails.
2. Prisma CLI reads .env, NOT .env.local. Both files must have DATABASE_URL.
3. npm naming restriction: "Kifayat" (capital K) is invalid as a package name.
   package.json uses lowercase "kifayat".
4. create-next-app had to be run in a temp subdirectory then moved.
5. The routingConfidence score is documented everywhere as a routing signal only,
   NOT an accuracy measure. It is never shown to the user.
6. qualityPreservation score IS shown to the user — cosine similarity of embeddings.

### BYOK security:
- Extracted from X-BYOK-Key request header
- Used in-request to create a per-request OpenAI client
- Never logged, stored, or persisted anywhere

### Graceful degradation:
- Every cascade tier catches errors and returns a degraded TierResult
- The degraded flag is shown to the user in the UI (amber warning badge)
- The API never throws uncaught exceptions

## Tests / Verification
- Browser subagent verified dashboard at http://localhost:3000
- No console errors
- Form submission works (degraded due to placeholder API key)
- DB persists one test run correctly

## Known Problems
- GROQ_API_KEY not set — user must add their real key to .env.local
- @xenova/transformers quality scorer falls back to word-overlap until model downloads

## Things NOT Yet Done
- Real API call testing (needs GROQ_API_KEY)
- npm run eval benchmark run
- BYOK testing
- page.module.css file (not needed — we use globals.css utility classes)

## Decisions Made
- All same as checkpoint-001 decisions, plus:
- @xenova/transformers as optional dep with fallback
- .env (not .env.local) for Prisma CLI
- Word-overlap similarity fallback in scorer.ts

## Current State
Full MVP implementation complete. Dev server running at http://localhost:3000.
Needs a real GROQ_API_KEY in .env.local to produce real optimization results.

## NEXT IMMEDIATE ACTION
Set GROQ_API_KEY in .env.local, restart dev server, test with a real prompt.

## NEXT 3 ACTIONS
1. Add real GROQ_API_KEY to .env.local
2. Test with a real prompt in the dashboard
3. Run `npm run eval` to generate benchmark numbers

## Resume From Here
1. Read PROJECT_CONTEXT.md, PROJECT_MEMORY.md, CURRENT_STATE.md
2. Confirm dev.db exists (it does)
3. Kill dev server if running (task-137), re-run `npm run dev` if needed
4. Add real GROQ_API_KEY to .env.local
5. Restart server: `npm run dev`
6. Test: paste any prompt into the dashboard and click Compare
