/**
 * POST /api/compare
 *
 * The demo endpoint: runs the same prompt through BOTH:
 *   1. The naive (unoptimized) path — direct call to a strong model
 *   2. The full Kifayat optimization pipeline
 *
 * Then computes and returns side-by-side metrics, including the quality-preservation
 * score (cosine similarity of embeddings).
 *
 * This endpoint powers the before/after dashboard visualization.
 *
 * Request body: { "prompt": string }
 * BYOK headers: X-BYOK-Key, X-BYOK-BaseURL (optional)
 *
 * Response: CompareOutput (see types.ts)
 */

import { NextRequest, NextResponse } from "next/server";
import { runOptimizedPipeline, runNaivePipeline, estimateCostUsd } from "@/lib/engine/pipeline";
import { computeQualityPreservation } from "@/lib/engine/scorer";
import { prisma } from "@/lib/db";
import type { ByokContext } from "@/lib/engine/types";

// Tier → model name (for cost calculation)
const TIER_MODELS: Record<number, string> = {
  0: "llama-3.1-8b-instant",
  1: "llama-3.1-8b-instant",
  2: "gpt-4o-mini",
  3: "llama-3.1-8b-instant",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt: string = body?.prompt ?? "";

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: "prompt is required and must not be empty" },
        { status: 400 }
      );
    }

    // Extract BYOK — never logged or stored
    const byokKey = req.headers.get("X-BYOK-Key");
    const byokBaseUrl = req.headers.get("X-BYOK-BaseURL");
    const byok: ByokContext | undefined = byokKey
      ? { apiKey: byokKey, baseUrl: byokBaseUrl ?? undefined }
      : undefined;

    // Run both paths in parallel for speed
    const [naiveResult, optimizedResult] = await Promise.all([
      runNaivePipeline(prompt, byok),
      runOptimizedPipeline(prompt, byok),
    ]);

    // Compute quality-preservation score
    const qualityPreservation = await computeQualityPreservation(
      optimizedResult.answer,
      naiveResult.answer
    );

    // Compute savings
    const naiveTotalTokens = naiveResult.tokensIn + naiveResult.tokensOut;
    const optimizedTotalTokens =
      optimizedResult.totalTokensIn + optimizedResult.totalTokensOut;

    const tokenSavingsPct =
      naiveTotalTokens > 0
        ? ((naiveTotalTokens - optimizedTotalTokens) / naiveTotalTokens) * 100
        : 0;

    const optimizedModel = TIER_MODELS[optimizedResult.tierUsed] ?? "llama-3.1-8b-instant";
    const optimizedCostUsd = estimateCostUsd(
      optimizedModel,
      optimizedResult.totalTokensIn,
      optimizedResult.totalTokensOut
    );

    const costSavingsPct =
      naiveResult.costUsd > 0
        ? ((naiveResult.costUsd - optimizedCostUsd) / naiveResult.costUsd) * 100
        : 0;

    // Persist run to database
    try {
      await prisma.queryRun.create({
        data: {
          prompt,
          naiveTokensIn: naiveResult.tokensIn,
          naiveTokensOut: naiveResult.tokensOut,
          naiveCostUsd: naiveResult.costUsd,
          naiveLatencyMs: naiveResult.latencyMs,
          naiveAnswer: naiveResult.answer,
          optimizedTokensIn: optimizedResult.totalTokensIn,
          optimizedTokensOut: optimizedResult.totalTokensOut,
          optimizedCostUsd,
          optimizedLatencyMs: optimizedResult.latencyMs,
          optimizedAnswer: optimizedResult.answer,
          tierUsed: optimizedResult.tierUsed,
          intentCategory: optimizedResult.intentCategory,
          wasDecomposed: optimizedResult.wasDecomposed,
          subtaskCount: optimizedResult.subtaskCount,
          degraded: optimizedResult.degraded,
          routingConfidence: optimizedResult.routingConfidence,
          qualityPreservation,
          tokenSavingsPct,
          costSavingsPct,
        },
      });
    } catch (dbErr) {
      // Database failure should not break the API response
      console.error("[/api/compare] DB write failed:", dbErr);
    }

    return NextResponse.json({
      naive: {
        answer: naiveResult.answer,
        tokensIn: naiveResult.tokensIn,
        tokensOut: naiveResult.tokensOut,
        costUsd: naiveResult.costUsd,
        latencyMs: naiveResult.latencyMs,
      },
      optimized: {
        answer: optimizedResult.answer,
        tokensIn: optimizedResult.totalTokensIn,
        tokensOut: optimizedResult.totalTokensOut,
        costUsd: optimizedCostUsd,
        latencyMs: optimizedResult.latencyMs,
        tierUsed: optimizedResult.tierUsed,
        intentCategory: optimizedResult.intentCategory,
        wasDecomposed: optimizedResult.wasDecomposed,
        degraded: optimizedResult.degraded,
      },
      qualityPreservation,
      tokenSavingsPct: Math.max(0, tokenSavingsPct),
      costSavingsPct: Math.max(0, costSavingsPct),
      routingConfidenceNote:
        "Internal routing confidence is not exposed here. See /api/optimize for details.",
    });
  } catch (err) {
    console.error("[/api/compare]", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        details:
          process.env.NODE_ENV === "development" ? String(err) : undefined,
      },
      { status: 500 }
    );
  }
}
