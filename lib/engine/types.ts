/**
 * Kifayat Engine — Shared Types
 *
 * Central type definitions used across all engine components.
 * Keep this file minimal — only types that cross component boundaries belong here.
 */

// ---------------------------------------------------------------------------
// Intent categories
// ---------------------------------------------------------------------------

/**
 * The set of intent categories the classifier recognises.
 * "general" is the catch-all for anything the classifier isn't sure about.
 *
 * This is NOT a fixed closed-world list — the classifier can produce any string,
 * but these are the well-known categories with specialised system prompts and
 * max_tokens caps. Unknown categories fall back to "general" behaviour.
 */
export type IntentCategory =
  | "math"
  | "code"
  | "summarization"
  | "sentiment"
  | "factual"
  | "creative"
  | "reasoning"
  | "extraction"
  | "translation"
  | "general";

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  category: IntentCategory;
  /** 0–1. How confident the classifier is. <0.6 = used cheap-model fallback. */
  confidence: number;
  /** Whether we fell back to a cheap-model call to classify. */
  usedModelFallback: boolean;
}

// ---------------------------------------------------------------------------
// Decomposer
// ---------------------------------------------------------------------------

export interface DecomposedQuery {
  subtasks: string[];
  wasDecomposed: boolean;
}

// ---------------------------------------------------------------------------
// Prompt Optimizer
// ---------------------------------------------------------------------------

export interface OptimizedPrompt {
  /** The trimmed/compressed user prompt sent as the human turn. */
  userPrompt: string;
  /** The specialised system prompt injected for this intent. */
  systemPrompt: string;
  /** Hard output token cap for this intent category. */
  maxTokens: number;
  /** Estimated number of tokens saved on the input side vs the original. */
  inputTokensSaved: number;
}

// ---------------------------------------------------------------------------
// Cascade / tier execution
// ---------------------------------------------------------------------------

/**
 * Result from running a single tier attempt.
 * The cascade uses this to decide whether to escalate.
 */
export interface TierResult {
  answer: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** 0–1 routing confidence heuristic. Used internally — NOT shown as accuracy. */
  routingConfidence: number;
  tier: 0 | 1 | 2 | 3;
  /** True if this tier hit an error and produced a degraded/fallback answer. */
  degraded: boolean;
}

// ---------------------------------------------------------------------------
// Full pipeline result (per subtask, then reassembled)
// ---------------------------------------------------------------------------

export interface SubtaskResult {
  subtask: string;
  classification: ClassificationResult;
  optimizedPrompt: OptimizedPrompt;
  tierResult: TierResult;
}

// ---------------------------------------------------------------------------
// Final optimised pipeline output
// ---------------------------------------------------------------------------

export interface OptimizedOutput {
  /** The final stitched answer shown to the user. */
  answer: string;
  subtaskResults: SubtaskResult[];

  totalTokensIn: number;
  totalTokensOut: number;
  latencyMs: number;

  /** Highest tier reached across all subtasks. */
  tierUsed: 0 | 1 | 2 | 3;
  /** Primary intent category (from the first or longest subtask). */
  intentCategory: IntentCategory;
  wasDecomposed: boolean;
  subtaskCount: number;
  degraded: boolean;

  /** Aggregate routing confidence (min across subtasks — most conservative). */
  routingConfidence: number;
}

// ---------------------------------------------------------------------------
// Compare endpoint — naive vs optimised
// ---------------------------------------------------------------------------

export interface NaiveResult {
  answer: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export interface CompareOutput {
  naive: NaiveResult;
  optimized: OptimizedOutput & { costUsd: number };
  qualityPreservation: number; // cosine similarity of embeddings
  tokenSavingsPct: number;
  costSavingsPct: number;
}

// ---------------------------------------------------------------------------
// BYOK context (request-scoped, never persisted)
// ---------------------------------------------------------------------------

export interface ByokContext {
  apiKey: string;
  /** OpenAI-compatible base URL. Defaults to OpenAI's endpoint if not supplied. */
  baseUrl?: string;
}
