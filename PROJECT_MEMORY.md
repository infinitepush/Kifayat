# PROJECT_MEMORY.md
# Kifayat — Long-Term Engineering Memory

This file records durable decisions, discoveries, and lessons. Never delete old entries.
If a decision changes, mark old as `Status: Superseded` and create a new one.

---

## Decision: SQLite over PostgreSQL

Date: 2026-09-27
Status: Active

Decision:
Use Prisma + SQLite as the database layer.

Reason:
A live demo must never depend on a database connection working on stage. SQLite is
a file on disk — zero external setup, zero connection failures, trivially portable.
The query volume is also very low (one write per user request).

Alternatives considered:
- PostgreSQL: correct for production, but requires a running server or a cloud connection.
- Turso (SQLite over libsql): interesting, but adds an external dependency.

Impact:
DATABASE_URL=file:./dev.db in .env. No connection pool needed.

---

## Decision: Exclude Ollama/local models from main demo path

Date: 2026-09-27
Status: Active

Decision:
Do NOT integrate Ollama or any local-model runner in the web demo path.

Reason:
The THRIFT reference project (our architecture inspiration) actually disabled their
Tier 1 local model for their own hackathon submission (SKIP_TIER_1 = true in their
config.py). This is real-world confirmation that local models are a demo liability:
cold-start latency, GPU requirements, VRAM OOM errors, model download size.

The free-tier fallback for MVP is a hosted OSS model via Groq/Fireworks free tier.
Ollama integration is an explicitly documented future enhancement.

Alternatives considered:
- Ollama via subprocess: ruled out, too fragile on stage.
- @xenova/transformers for generation: this library IS used, but only for tiny
  embedding inference (all-MiniLM-L6-v2), not for text generation.

Impact:
Tier 3 = Groq free-tier model (e.g. llama-3.1-8b-instant), not local Ollama.

---

## Decision: Groq as primary provider for Tier 1 and Tier 3

Date: 2026-09-27
Status: Active

Decision:
Use Groq API for both Tier 1 (cheap/fast) and Tier 3 (free fallback).

Reason:
- Groq offers an extremely fast inference API.
- Has a generous free tier (useful for demos without a BYOK key).
- OpenAI-compatible API format simplifies integration.
- llama-3.1-8b-instant for Tier 1, llama-3.1-70b-versatile for Tier 2 (with BYOK).

Alternatives considered:
- Fireworks: also valid, similar pricing, slightly less documentation.
- Together.ai: good but more setup complexity.

Impact:
GROQ_API_KEY environment variable required for both Tier 1 and Tier 3.
BYOK users can supply any OpenAI-compatible key via X-BYOK-Key + X-BYOK-BaseURL headers.

---

## Decision: THRIFT as architecture reference, not code source

Date: 2026-09-27
Status: Active

Decision:
The open-source THRIFT project (MIT-licensed AMD hackathon entry) is used as an
architecture reference only. Ideas are ported into TypeScript; no Python code is
copy-pasted verbatim.

Reason:
Academic integrity for faculty demo and resume use. The honest story is better:
"cascade design inspired by THRIFT, extended for general-purpose prompts, BYOK,
and quality scoring."

What IS borrowed:
- 3-tier cascade architecture concept
- Conservative query decomposer philosophy
- Per-intent specialized system prompts pattern
- Heuristic confidence scorer approach (hedge/refusal phrases, length checks)

What is genuinely original:
- General-purpose classifier (not fixed 19-task list)
- BYOK header-based key injection
- Quality-preservation score via local embeddings
- Naive-vs-optimized comparator endpoint
- TypeScript/Next.js implementation

Impact:
README must contain attribution note.

---

## Decision: Dual scoring system

Date: 2026-09-27
Status: Active

Decision:
Two separate scores, not one:

1. Internal routing confidence — heuristic (hedge phrases, refusal phrases,
   length/format checks). Drives cascade escalation. Never shown to the user as
   an "accuracy" claim. Code comments must be explicit about this.

2. Quality-preservation score — cosine similarity between the embedding of the
   optimized answer and the embedding of the naive (unoptimized) baseline answer
   for the same prompt. Computed with @xenova/transformers + all-MiniLM-L6-v2
   running locally in Node. This is the score shown on the dashboard.

Reason:
Conflating them is intellectually dishonest. The routing confidence is an
engineering signal, not a validated accuracy measure. The quality-preservation
score is a real comparison. A faculty judge who asks "how did you validate this?"
gets a defensible answer: cosine similarity against a strong-model reference.

Impact:
Both scores stored separately in the QueryRun database model.
Dashboard shows quality-preservation score only (with explanation tooltip).

---

## Decision: Vanilla CSS (no Tailwind) for styling

Date: 2026-09-27
Status: Active

Decision:
Use vanilla CSS for all styling. No Tailwind.

Reason:
Project plan spec and technology guidance specifies vanilla CSS. Also avoids
JIT build complexity in Next.js App Router.

Impact:
All styles in app/globals.css and component-level .module.css files.

---

## API/Provider Memory: Groq

Provider: Groq
Base URL: https://api.groq.com/openai/v1
SDK: openai (npm package, using baseURL override)
Authentication: Bearer GROQ_API_KEY
Tier 1 model: llama-3.1-8b-instant
Tier 3 (free fallback) model: llama-3.1-8b-instant
Tier 2 model: llama-3.1-70b-versatile (with BYOK or pooled key)
Token fields: usage.prompt_tokens, usage.completion_tokens
Known limits: Rate limits on free tier; returns standard OpenAI-format responses
Fallback behavior: On rate limit or error, cascade escalates to next tier

---

## Environment Variables Required

```
GROQ_API_KEY=           # Tier 1 and Tier 3; required
OPENAI_API_KEY=         # Optional pooled Tier 2 key
DATABASE_URL=file:./dev.db
```

BYOK injected at request time via headers:
- X-BYOK-Key: <user's api key>
- X-BYOK-BaseURL: <optional base URL override, defaults to OpenAI>

NEVER store actual key values in this file or any repository file.

---

## Development Commands

```bash
npm run dev        # Start dev server (port 3000)
npm run build      # Production build
npx prisma migrate dev  # Apply schema changes
npx prisma studio  # Browse database
npm run eval       # Run benchmark eval script (scripts/eval.ts)
```
