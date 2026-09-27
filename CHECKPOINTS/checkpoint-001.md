# CHECKPOINT 001

## Date
2026-09-27

## Session Objective
Bootstrap the Kifayat project from scratch: create the Next.js scaffold,
set up persistent memory files, install all dependencies, configure Prisma,
and begin Week 1 engine implementation (Classifier + Decomposer).

## What Was Completed
- PROJECT_CONTEXT.md created — full architecture, stack, MVP scope, out-of-scope, future enhancements
- PROJECT_MEMORY.md created — all initial engineering decisions documented
- CURRENT_STATE.md created — current state with next tasks
- Next.js scaffold command running (kifayat-temp subdirectory, due to npm naming restriction on "Kifayat")

## What Changed
### Files Created
- PROJECT_CONTEXT.md
- PROJECT_MEMORY.md
- CURRENT_STATE.md
- CHECKPOINTS/checkpoint-001.md (this file)

### Files Modified
- (none yet)

### Files Deleted
- (none)

## Architecture Changes
Not yet implemented — architecture exists as documentation only.

## Important Implementation Details
- npm naming restriction: `create-next-app` cannot use "Kifayat" as package name
  (capital letters forbidden). Workaround: scaffold into `kifayat-temp/`, then
  move all files to the root `Kifayat/` directory and update package.json name to
  `kifayat` (lowercase).
- Provider choice: Groq for Tier 1 (llama-3.1-8b-instant) and Tier 3 (same model
  as free fallback). OpenAI-compatible API for Tier 2 (BYOK or pooled key).
- Embedding model: @xenova/transformers + all-MiniLM-L6-v2 (local, no API key).

## Tests / Verification
None yet — implementation not started.

## Known Problems
- None yet

## Things NOT Yet Done
- All application code
- Prisma schema
- Any engine components (Decomposer, Classifier, Optimizer, Cascade, etc.)
- API routes (/api/optimize, /api/compare)
- Dashboard page
- Eval script

## Decisions Made
- SQLite over PostgreSQL
- Groq as Tier 1 and Tier 3 provider
- Dual scoring system (routing confidence internal only; quality-preservation shown)
- Vanilla CSS, no Tailwind
- THRIFT as reference only

## Current State
Empty repository with memory files. Next.js scaffold in progress.

## NEXT IMMEDIATE ACTION
1. Wait for scaffold to complete
2. Move files from kifayat-temp/ to root
3. Fix package.json name to "kifayat"
4. Install: `npm install openai @prisma/client mathjs chart.js`
5. Install dev: `npm install -D prisma`
6. Note: @xenova/transformers has known ESM issues in Next.js — may need
   dynamic import or worker approach. Investigate and document.

## NEXT 3 ACTIONS
1. Install all dependencies (openai, prisma, mathjs, chart.js, @xenova/transformers)
2. Create prisma/schema.prisma with QueryRun model + run migration
3. Implement lib/engine/classifier.ts — regex-first + cheap-model-fallback

## Resume From Here
1. Read PROJECT_CONTEXT.md, PROJECT_MEMORY.md, CURRENT_STATE.md
2. Run `dir` to see actual files in workspace
3. If scaffold isn't moved yet: move kifayat-temp/* to root
4. Continue from NEXT IMMEDIATE ACTION above
