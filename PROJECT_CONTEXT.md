# PROJECT_CONTEXT.md
# Kifayat — LLM Token & Cost Optimization Engine

> "Kifayat" = Hindi/Urdu for thriftiness/economy

---

## 1. Project Name
Kifayat

## 2. Project Purpose
A proxy layer that sits between a user's prompt and an LLM API. It cuts token
usage on both the input and output side, routes to the cheapest model/tier that
can handle the task, and proves — with real numbers, not vibes — that it didn't
sacrifice answer quality.

## 3. Problem Being Solved
LLM API calls are expensive, slow, and wasteful by default:
- Most prompts contain filler that inflates input token counts.
- Outputs rephrase, caveat, and repeat themselves.
- All requests are routed to expensive frontier models when cheap ones suffice.
- There is no standard way to measure whether an "optimized" answer is still high quality.

## 4. Target Users
B.Tech/CS students, indie developers, small teams — anyone wanting to demo or
understand cost-reduction techniques for LLM APIs. Also relevant as a portfolio
and faculty demo piece.

## 5. Core Product Idea
1. Receive a user prompt (+ optional BYOK API key + optional context).
2. Run it through a pipeline of cost-reduction techniques.
3. Return the answer AND a side-by-side comparison: naive (unoptimized) vs optimized,
   showing token counts, estimated cost, latency, and quality-preservation score.
4. Log all runs to a dashboard with cumulative stats.

## 6. Architecture

```
User Prompt (+ optional BYOK key + optional conversation context)
        │
        ▼
  [1] Decomposer
        │  Conservative split: numbered lists / semicolons / "and"+different-intent
        ▼  (per subtask)
  [2] Classifier
        │  Regex/keyword pass first (fast, free)
        │  Falls back to ONE cheap-model call only when regex is unsure
        ▼
  [3] Prompt Optimizer
        │  INPUT side: trim filler, summarize long pasted context above token threshold
        │  OUTPUT side: inject per-intent system prompt + hard max_tokens cap
        ▼
  [4] Cascade (main engine)
        ├── Tier 0: free instant heuristics (safe-math AST eval, exact-match cache)
        ├── Tier 1: cheap fast hosted model (Groq), confidence-checked
        ├── Tier 2: stronger model (BYOK key or pooled key) if Tier 1 confidence is low
        └── Tier 3: free OSS fallback if BYOK absent/exhausted
        ▼
  [5] Reassembler
        │  Stitch subtask answers back into one coherent response
        ▼
  [6] Scorer
        │  Internal routing confidence (heuristic, drives escalation — NOT shown as accuracy)
        │  Quality-preservation score (cosine sim of embeddings: optimized vs naive baseline)
        ▼
  Run Logger (Prisma → SQLite)
        ▼
  Dashboard (Chart.js, Next.js page)
```

## 7. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Vanilla CSS (no Tailwind) |
| Database | Prisma + SQLite (zero external DB) |
| Charts | Chart.js |
| LLM Providers | Groq (cheap/fast Tier 1), OpenAI-compatible (Tier 2 BYOK) |
| Free fallback | Groq free tier / Fireworks |
| Local embeddings | @xenova/transformers (all-MiniLM-L6-v2, runs in Node) |
| Math eval | mathjs (safe AST evaluation — no eval()) |

## 8. MVP Scope (Build These)

- Conservative decomposer (numbered list / semicolon / "and"-different-intent splitting)
- Regex-first, cheap-model-fallback classifier (general categories, not fixed task list)
- Input trimming + output constraint prompt injection per intent
- 3-tier cascade with confidence-gated escalation + BYOK header support + free-tier fallback
- Reassembler for compound-query answers
- Dual scoring system:
  - Internal routing confidence (heuristic, cascade-only, never shown as accuracy)
  - Quality-preservation score (cosine sim, shown on dashboard)
- `/api/optimize` (main endpoint)
- `/api/compare` (naive-vs-optimized demo endpoint)
- Dashboard page: live before/after chart, run history, aggregate stats
- Eval script: 15–20 benchmark prompts → avg token savings %, avg quality score, tier breakdown

## 9. Explicitly Out of Scope (MVP)

- True local-model (Ollama) integration — desktop/IDE-only, too unstable for live demo
- Semantic/near-duplicate caching (only exact-match cache for MVP)
- Price-aware dynamic model ranking (use a small hardcoded priority list for MVP)
- A trained confidence classifier (heuristic is fine for MVP)
- Multi-turn / agent-trace-level compression (single-prompt only for MVP)
- Stop-sequences tuned per intent
- Structured-output/JSON-schema mode
- RAG-lite retrieval-based context

## 10. Planned Future Enhancements

1. Semantic near-duplicate cache (embedding similarity across query history)
2. Price-aware dynamic model ranking (live pricing API)
3. Trained confidence classifier (replacing the heuristic)
4. True Ollama/local model offline mode (VS Code extension or desktop app)
5. Multi-turn / agent-trace-level compression
6. Per-user budget policies, spend alerts, quality drift monitoring

## 11. Important Constraints

- Never persist a user's BYOK key server-side.
- Never crash on malformed/empty query or failed tier — always degrade gracefully.
- Be explicit in code comments about what routing confidence score claims and doesn't claim.
- Architecture reference: THRIFT (MIT-licensed AMD hackathon project).
  Do NOT paste THRIFT code verbatim — port the ideas into TypeScript.
  In README, acknowledge: "cascade design inspired by THRIFT, extended for general-purpose prompts."
- Local model (Ollama) is out of scope for the web demo — do not add it.

## 12. Design Principles

- **General-purpose first**: The classifier must handle arbitrary prompts, not a fixed known task list.
- **Fail gracefully**: Always return a well-formed result; never return nothing.
- **Honest scoring**: The routing confidence is a heuristic routing signal, not a validated accuracy measure.
- **The quality-preservation score is the real demo number**: cosine similarity of embeddings.
- **Web-deployable**: No local model dependencies in the main demo path.
- **Resume-safe**: PROJECT_CONTEXT.md, PROJECT_MEMORY.md, CURRENT_STATE.md, and CHECKPOINTS/ are the persistent memory of this project.
