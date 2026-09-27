/**
 * Kifayat Engine — Cascade
 *
 * The main routing engine. Tries tiers in order, escalates on low confidence.
 *
 * Tier 0: Free instant heuristics
 *   - Safe arithmetic evaluation (mathjs AST, no eval())
 *   - Exact-match cache (in-memory, process-lifetime)
 *
 * Tier 1: Cheap fast hosted model (Groq llama-3.1-8b-instant)
 *   - Confidence-gated: escalates to Tier 2 if routing confidence < threshold
 *   - "Hard" intents (code, reasoning) skip-ahead to Tier 2 immediately
 *
 * Tier 2: Stronger model (BYOK key or pooled OpenAI key)
 *   - Used when Tier 1 confidence is low, or for hard intents
 *   - BYOK key injected per-request via headers, NEVER persisted server-side
 *
 * Tier 3: Free OSS fallback (Groq free-tier model)
 *   - Used when BYOK is absent/exhausted or Tier 2 also fails
 *   - Same as Tier 1 model — Groq's free tier is the safety net
 *
 * NOTE: Local Ollama is explicitly OUT OF SCOPE for the main demo path.
 * See PROJECT_MEMORY.md — "Exclude Ollama/local models from main demo path".
 *
 * Architecture inspired by THRIFT's cascade.py, rewritten in TypeScript with:
 * - General-purpose classifier (not a fixed task list)
 * - BYOK support
 * - Free-tier OSS fallback instead of local model
 */

import OpenAI from "openai";
import * as math from "mathjs";
import type {
  IntentCategory,
  OptimizedPrompt,
  TierResult,
  ByokContext,
} from "./types";
import { scoreRoutingConfidence } from "./confidence";
import { postProcessAnswer, estimateTokens } from "./optimizer";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TIER1_MODEL = "openai/gpt-oss-20b"; // Groq cheap/fast
const TIER2_MODEL = "gpt-4o-mini"; // Default Tier 2 model (OpenAI or BYOK)
const TIER3_MODEL = "openai/gpt-oss-20b"; // Groq free fallback

// Confidence below this threshold → escalate to next tier
const CONFIDENCE_THRESHOLD = 0.65;

// "Hard" intents skip Tier 1 and go straight to Tier 2
// Rationale: these categories are reliably weak on small models, so don't waste a round-trip
const HARD_INTENTS: IntentCategory[] = ["code", "reasoning"];

// ---------------------------------------------------------------------------
// Exact-match cache (Tier 0)
// In-memory, keyed on the exact user prompt string (trimmed lowercase)
// MVP: exact-match only. Semantic cache is a future enhancement.
// ---------------------------------------------------------------------------

interface CacheEntry {
  answer: string;
  category: IntentCategory;
  cachedAt: number;
}

const EXACT_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

function getFromCache(prompt: string): CacheEntry | null {
  const key = getCacheKey(prompt);
  const entry = EXACT_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    EXACT_CACHE.delete(key);
    return null;
  }
  return entry;
}

export function setCache(
  prompt: string,
  answer: string,
  category: IntentCategory
): void {
  const key = getCacheKey(prompt);
  EXACT_CACHE.set(key, { answer, category, cachedAt: Date.now() });
}

export function clearCache(): void {
  EXACT_CACHE.clear();
}

// ---------------------------------------------------------------------------
// Tier 0: Safe arithmetic eval
// ---------------------------------------------------------------------------

/**
 * Try to evaluate the prompt as a pure arithmetic expression.
 * Uses mathjs (AST-based) — never eval(). Safe.
 *
 * Returns null if the prompt doesn't look like pure arithmetic.
 */
function tryArithmeticEval(prompt: string): string | null {
  const cleaned = prompt
    .trim()
    // Remove question-ifying language
    .replace(
      /^(what is|calculate|compute|evaluate|simplify|solve|what's|find)[\s:]+/i,
      ""
    )
    .replace(/[?.]$/, "")
    .replace(/\bthe\s+/gi, "")
    .replace(/square root of\s*([\d.]+)/i, "sqrt($1)")
    .replace(/([\d.]+)%\s*of\s*([\d.]+)/i, "$1% * $2")
    .trim();

  // Only attempt if it looks like an arithmetic expression
  if (!/^[\d\s+\-*/^%().sqrt]+$/i.test(cleaned)) return null;

  try {
    const result = math.evaluate(cleaned);
    if (typeof result === "number" && isFinite(result)) {
      return String(result);
    }
  } catch {
    // Not valid arithmetic — fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 0: Full heuristic handling
// ---------------------------------------------------------------------------

async function runTier0(
  prompt: string,
  category: IntentCategory,
  optimized: OptimizedPrompt
): Promise<TierResult | null> {
  const start = Date.now();

  // 1. Exact-match cache
  const cached = getFromCache(optimized.userPrompt);
  if (cached) {
    return {
      answer: cached.answer,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      routingConfidence: 1.0,
      tier: 0,
      degraded: false,
    };
  }

  // 2. Safe arithmetic (math category only)
  if (category === "math") {
    const mathAnswer = tryArithmeticEval(optimized.userPrompt);
    if (mathAnswer !== null) {
      return {
        answer: mathAnswer,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - start,
        routingConfidence: 1.0,
        tier: 0,
        degraded: false,
      };
    }
  }

  // Nothing in Tier 0 handled it
  return null;
}

// ---------------------------------------------------------------------------
// Shared: call an OpenAI-compatible model
// ---------------------------------------------------------------------------

import { withRetry } from "./retry";

async function callModel(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  category: IntentCategory,
  tierNum: 0 | 1 | 2 | 3
): Promise<TierResult> {
  const start = Date.now();

  try {
    const response = await withRetry(() =>
      client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: category === "code" ? 0.1 : 0.3,
      })
    );

    const rawAnswer = response.choices[0]?.message?.content ?? "";
    const answer = postProcessAnswer(rawAnswer, category);
    const tokensIn = response.usage?.prompt_tokens ?? estimateTokens(systemPrompt + userPrompt);
    const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;
    const rawTokensOut = response.usage?.completion_tokens ?? estimateTokens(answer);
    const tokensOut = Math.max(estimateTokens(answer), rawTokensOut - reasoningTokens);
    const confidence = scoreRoutingConfidence(answer, category);

    // Cache successful responses
    if (confidence >= CONFIDENCE_THRESHOLD) {
      setCache(userPrompt, answer, category);
    }

    return {
      answer,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - start,
      routingConfidence: confidence,
      tier: tierNum,
      degraded: false,
    };
  } catch (err) {
    console.error(`[cascade] Tier ${tierNum} model call failed:`, err);
    // Return degraded result — never crash
    return {
      answer: "I was unable to process this request. Please try again.",
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - start,
      routingConfidence: 0,
      tier: tierNum,
      degraded: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CascadeInput {
  optimizedPrompt: OptimizedPrompt;
  category: IntentCategory;
  byok?: ByokContext;
  groqClient: OpenAI;
  tier2Client?: OpenAI; // pooled Tier 2 client (if no BYOK)
}

/**
 * Run the full cascade for a single subtask.
 *
 * Tries tiers in order (0 → 1 → 2 → 3), escalating on low confidence.
 * Always returns a well-formed result — never throws.
 */
export async function runCascade(input: CascadeInput): Promise<TierResult> {
  const { optimizedPrompt, category, byok, groqClient } = input;
  const { userPrompt, systemPrompt, maxTokens } = optimizedPrompt;

  // ── Tier 0: Free heuristics ──────────────────────────────────────────────
  const tier0 = await runTier0(userPrompt, category, optimizedPrompt);
  if (tier0) return tier0;

  // Skip Tier 1 for "hard" intents — go straight to Tier 2
  const isHardIntent = HARD_INTENTS.includes(category);

  // ── Tier 1: Cheap model ──────────────────────────────────────────────────
  if (!isHardIntent) {
    const tier1 = await callModel(
      groqClient,
      TIER1_MODEL,
      systemPrompt,
      userPrompt,
      maxTokens,
      category,
      1
    );

    if (tier1.routingConfidence >= CONFIDENCE_THRESHOLD && !tier1.degraded) {
      return tier1;
    }

    // Low confidence — escalate, but remember Tier 1 as fallback
    // (If Tier 2 and 3 both fail, we return the best of what we have)
  }

  // ── Tier 2: Stronger model (BYOK or pooled key) ──────────────────────────
  let tier2Client: OpenAI | null = null;

  if (byok?.apiKey) {
    // User provided their own key — use it
    tier2Client = new OpenAI({
      apiKey: byok.apiKey,
      baseURL: byok.baseUrl ?? "https://api.openai.com/v1",
    });
  } else if (input.tier2Client) {
    // Pooled Tier 2 client (server-side key)
    tier2Client = input.tier2Client;
  }

  if (tier2Client) {
    const tier2 = await callModel(
      tier2Client,
      TIER2_MODEL,
      systemPrompt,
      userPrompt,
      maxTokens,
      category,
      2
    );

    if (!tier2.degraded) return tier2;
  }

  // ── Tier 3: Free OSS fallback ─────────────────────────────────────────────
  // Uses the same Groq client but a potentially different model.
  // This is the "always-on" safety net — no key needed beyond GROQ_API_KEY.
  const tier3 = await callModel(
    groqClient,
    TIER3_MODEL,
    systemPrompt,
    userPrompt,
    Math.min(maxTokens * 2, 1024), // slightly more generous for fallback
    category,
    3
  );

  return tier3;
}
