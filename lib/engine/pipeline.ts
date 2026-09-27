/**
 * Kifayat Engine — Main Pipeline Orchestrator
 *
 * Wires together: Decomposer → Classifier → Optimizer → Cascade → Reassembler
 *
 * Also provides the naive (unoptimised) run for the /api/compare endpoint.
 */

import OpenAI from "openai";
import { decomposeQuery } from "./decomposer";
import { classifyIntent } from "./classifier";
import { optimizePrompt, estimateTokens, postProcessAnswer } from "./optimizer";
import { runCascade } from "./cascade";
import { reassemble } from "./reassembler";
import { withRetry } from "./retry";
import type {
  OptimizedOutput,
  SubtaskResult,
  ByokContext,
  NaiveResult,
  IntentCategory,
} from "./types";

// ---------------------------------------------------------------------------
// Provider clients
// ---------------------------------------------------------------------------

function getGroqClient(): OpenAI {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY environment variable is required. Set it in .env.local"
    );
  }
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

function getTier2Client(): OpenAI | undefined {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return undefined;
  return new OpenAI({ apiKey: key });
}

// ---------------------------------------------------------------------------
// Cost estimation (rough, using public pricing as of 2024)
// ---------------------------------------------------------------------------

interface ModelPricing {
  inputPerMToken: number; // USD per million input tokens
  outputPerMToken: number; // USD per million output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "openai/gpt-oss-20b": { inputPerMToken: 0.075, outputPerMToken: 0.30 },
  "openai/gpt-oss-120b": { inputPerMToken: 0.15, outputPerMToken: 0.60 },
  "llama-3.1-8b-instant": { inputPerMToken: 0.05, outputPerMToken: 0.08 },
  "llama-3.1-70b-versatile": { inputPerMToken: 0.59, outputPerMToken: 0.79 },
  "gpt-4o-mini": { inputPerMToken: 0.15, outputPerMToken: 0.60 },
  "gpt-4o": { inputPerMToken: 5.0, outputPerMToken: 15.0 },
  "default": { inputPerMToken: 0.5, outputPerMToken: 1.5 },
};

export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["default"];
  return (
    (tokensIn / 1_000_000) * pricing.inputPerMToken +
    (tokensOut / 1_000_000) * pricing.outputPerMToken
  );
}

// Tier → model name mapping (for cost calculation)
const TIER_MODELS: Record<number, string> = {
  0: "openai/gpt-oss-20b", // free tier, 0 actual cost
  1: "openai/gpt-oss-20b",
  2: "gpt-4o-mini",
  3: "openai/gpt-oss-20b",
};

// ---------------------------------------------------------------------------
// Optimised pipeline
// ---------------------------------------------------------------------------

export async function runOptimizedPipeline(
  prompt: string,
  byok?: ByokContext
): Promise<OptimizedOutput> {
  const groqClient = getGroqClient();
  const tier2Client = getTier2Client();
  const pipelineStart = Date.now();

  if (!prompt?.trim()) {
    return createEmptyOutput(prompt);
  }

  // Step 1: Decompose
  const { subtasks, wasDecomposed } = decomposeQuery(prompt);

  // Step 2–4: Classify → Optimize → Cascade for each subtask
  const subtaskResults: SubtaskResult[] = [];

  for (const subtask of subtasks) {
    // Classify
    const classification = await classifyIntent(subtask, groqClient);

    // Optimize
    const optimizedPrompt = optimizePrompt(subtask, classification.category);

    // Cascade
    const tierResult = await runCascade({
      optimizedPrompt,
      category: classification.category,
      byok,
      groqClient,
      tier2Client,
    });

    subtaskResults.push({ subtask, classification, optimizedPrompt, tierResult });
  }

  // Step 5: Reassemble
  const finalAnswer = reassemble(subtaskResults);

  // Aggregate metrics
  const totalTokensIn = subtaskResults.reduce(
    (sum, r) => sum + r.tierResult.tokensIn + r.optimizedPrompt.inputTokensSaved,
    0
  );
  const totalOptimizedTokensIn = subtaskResults.reduce(
    (sum, r) => sum + r.tierResult.tokensIn,
    0
  );
  const totalTokensOut = subtaskResults.reduce(
    (sum, r) => sum + r.tierResult.tokensOut,
    0
  );
  const maxTier = Math.max(...subtaskResults.map((r) => r.tierResult.tier)) as
    | 0
    | 1
    | 2
    | 3;
  const primaryCategory =
    subtaskResults[0]?.classification.category ?? "general";
  const anyDegraded = subtaskResults.some((r) => r.tierResult.degraded);
  const minConfidence = Math.min(
    ...subtaskResults.map((r) => r.tierResult.routingConfidence)
  );

  return {
    answer: finalAnswer,
    subtaskResults,
    totalTokensIn: totalOptimizedTokensIn,
    totalTokensOut,
    latencyMs: Date.now() - pipelineStart,
    tierUsed: maxTier,
    intentCategory: primaryCategory as IntentCategory,
    wasDecomposed,
    subtaskCount: subtasks.length,
    degraded: anyDegraded,
    routingConfidence: minConfidence,
  };
}

// ---------------------------------------------------------------------------
// Naive (unoptimised) run — for /api/compare
// ---------------------------------------------------------------------------

const NAIVE_MODEL = "gpt-4o-mini"; // Strong model, no optimization

export async function runNaivePipeline(
  prompt: string,
  byok?: ByokContext
): Promise<NaiveResult> {
  const start = Date.now();

  let client: OpenAI;
  let model = NAIVE_MODEL;

  if (byok?.apiKey) {
    client = new OpenAI({
      apiKey: byok.apiKey,
      baseURL: byok.baseUrl ?? "https://api.openai.com/v1",
    });
  } else {
    const pooledKey = process.env.OPENAI_API_KEY;
    if (!pooledKey) {
      // Fall back to Groq strong model if no OpenAI key
      client = getGroqClient();
      model = "openai/gpt-oss-120b";
    } else {
      client = new OpenAI({ apiKey: pooledKey });
    }
  }

  try {
    const response = await withRetry(() =>
      client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048, // generous, no cap
      })
    );

    const rawAnswer = response.choices[0]?.message?.content ?? "";
    const answer = postProcessAnswer(rawAnswer, "general");
    const tokensIn = response.usage?.prompt_tokens ?? estimateTokens(prompt);
    const reasoningTokens = (response.usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;
    const rawTokensOut = response.usage?.completion_tokens ?? estimateTokens(answer);
    const tokensOut = Math.max(estimateTokens(answer), rawTokensOut - reasoningTokens);

    return {
      answer,
      tokensIn,
      tokensOut,
      costUsd: estimateCostUsd(model, tokensIn, tokensOut),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    console.error("[pipeline] Naive run failed:", err);
    return {
      answer: "Failed to get naive baseline response.",
      tokensIn: estimateTokens(prompt),
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyOutput(prompt: string): OptimizedOutput {
  return {
    answer: "",
    subtaskResults: [],
    totalTokensIn: 0,
    totalTokensOut: 0,
    latencyMs: 0,
    tierUsed: 0,
    intentCategory: "general",
    wasDecomposed: false,
    subtaskCount: 0,
    degraded: false,
    routingConfidence: 0,
  };
}
