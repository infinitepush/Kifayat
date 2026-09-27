/**
 * Kifayat Engine — Routing Confidence Scorer
 *
 * IMPORTANT DISCLAIMER — read before using this module:
 *
 * This scorer produces a "routing confidence" value used ONLY to decide whether
 * to escalate from one cascade tier to the next. It is a cheap heuristic, NOT
 * a validated accuracy measure.
 *
 * It SHOULD NOT be interpreted as "probability that this answer is correct."
 * It SHOULD NOT be shown to the user as an accuracy score.
 * It IS safe to use as an internal signal to gate escalation decisions.
 *
 * Inspired by THRIFT's heuristic confidence scorer (hedge phrases, refusal
 * phrases, length/format checks) — ported to TypeScript with additional signals.
 *
 * The quality-preservation score (cosine similarity of embeddings) is the
 * defensible score shown on the dashboard — see scorer.ts.
 */

import type { IntentCategory } from "./types";

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** Phrases that indicate the model is uncertain or hedging. */
const HEDGE_PHRASES: RegExp[] = [
  /\b(I think|I believe|I'm not sure|I am not sure|I'm uncertain|not certain|might be|may be|possibly|probably|perhaps|it seems|it appears|as far as I know|to my knowledge|I could be wrong)\b/i,
  /\b(approximately|around|roughly|about|estimated|unclear)\b/i,
];

/** Phrases that indicate the model is refusing to answer. */
const REFUSAL_PHRASES: RegExp[] = [
  /\b(I cannot|I can't|I'm unable|I am unable|I don't know|I do not know|I have no (information|knowledge|data)|I'm not able|I cannot provide|I'm afraid I|outside my (knowledge|training))\b/i,
  /\b(As an AI|as a language model)[^.]*\b(cannot|can't|unable|don't have access|no access)\b/i,
];

/** Phrases that signal a very short, unhelpful non-answer. */
const NONANSWER_PHRASES: RegExp[] = [
  /^(I don't know|I'm not sure|I cannot|N\/A|Unknown|No answer|Not applicable|None)[.!?]?$/i,
  /^(Sorry|I apologize|Apologies)[,.!]?\s*(I|but)\b/i,
];

// ---------------------------------------------------------------------------
// Format compliance checkers
// ---------------------------------------------------------------------------

function checkFormatCompliance(
  answer: string,
  category: IntentCategory
): number {
  switch (category) {
    case "sentiment":
      // Should be exactly one word: Positive/Negative/Neutral/Mixed
      if (/^(Positive|Negative|Neutral|Mixed)[.!]?$/i.test(answer.trim())) return 1.0;
      if (answer.trim().split(/\s+/).length <= 5) return 0.9;
      return 0.5;

    case "math":
      // Should start with a number or contain a clear numeric answer
      if (/^\d|^-\d|^Answer:\s*[\d-]/.test(answer.trim())) return 1.0;
      if (/\d/.test(answer)) return 0.8;
      return 0.5;

    case "code":
      // Should contain a code block
      if (/```[\s\S]+```/.test(answer)) return 1.0;
      if (/def |function |class |const |let /.test(answer)) return 0.75;
      return 0.5;

    case "extraction":
      // Should contain structured output
      if (/\[.*\]|\{.*\}|^[-•*]\s/ms.test(answer)) return 1.0;
      return 0.7;

    default:
      return 0.9; // no specific format requirement, assume ok
  }
}

// ---------------------------------------------------------------------------
// Length heuristics
// ---------------------------------------------------------------------------

function scoreLengthHeuristic(answer: string, category: IntentCategory): number {
  const len = answer.trim().length;
  const words = answer.trim().split(/\s+/).length;

  // Suspiciously short answers for categories that need substance
  const needsSubstance: IntentCategory[] = [
    "code",
    "summarization",
    "reasoning",
    "creative",
    "translation",
  ];

  if (needsSubstance.includes(category) && len < 50) return 0.3;
  if (needsSubstance.includes(category) && len < 100) return 0.6;

  // Suspiciously long answers for categories that should be brief
  const shouldBeBrief: IntentCategory[] = ["sentiment", "math", "factual"];
  if (shouldBeBrief.includes(category) && words > 200) return 0.6;

  // Empty answer
  if (len === 0) return 0.0;

  return 1.0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a model's answer for internal cascade routing purposes.
 *
 * Returns a value 0–1. The cascade escalates if this falls below its threshold.
 *
 * REMINDER: This is a routing heuristic, NOT an accuracy measure.
 */
export function scoreRoutingConfidence(
  answer: string,
  category: IntentCategory
): number {
  const text = answer.trim();

  if (!text) return 0.0;

  let score = 1.0;

  // Check for non-answers
  for (const pattern of NONANSWER_PHRASES) {
    if (pattern.test(text)) return 0.1;
  }

  // Refusal penalty
  for (const pattern of REFUSAL_PHRASES) {
    if (pattern.test(text)) {
      score *= 0.2;
      break;
    }
  }

  // Hedge phrase penalty (each hedge reduces confidence a little)
  let hedgeCount = 0;
  for (const pattern of HEDGE_PHRASES) {
    const matches = text.match(new RegExp(pattern.source, "gi"));
    hedgeCount += matches?.length ?? 0;
  }
  if (hedgeCount > 0) {
    score *= Math.max(0.4, 1 - hedgeCount * 0.1);
  }

  // Format compliance
  const formatScore = checkFormatCompliance(text, category);
  score *= formatScore;

  // Length heuristic
  const lengthScore = scoreLengthHeuristic(text, category);
  score *= lengthScore;

  return Math.min(1.0, Math.max(0.0, score));
}
