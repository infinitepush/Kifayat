/**
 * POST /api/optimize
 *
 * Main endpoint: runs the prompt through the full Kifayat optimization pipeline.
 *
 * Request body:
 * {
 *   "prompt": string,        // required
 *   "context"?: string       // optional conversation context
 * }
 *
 * BYOK headers (optional, never persisted server-side):
 *   X-BYOK-Key: <api-key>
 *   X-BYOK-BaseURL: <optional-base-url>
 *
 * Response:
 * {
 *   "answer": string,
 *   "tokensIn": number,
 *   "tokensOut": number,
 *   "latencyMs": number,
 *   "tierUsed": 0|1|2|3,
 *   "intentCategory": string,
 *   "wasDecomposed": boolean,
 *   "degraded": boolean,
 *   "routingConfidenceNote": string   // disclaimer text, not the value
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { runOptimizedPipeline, estimateCostUsd } from "@/lib/engine/pipeline";
import { prisma } from "@/lib/db";
import type { ByokContext } from "@/lib/engine/types";

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

    // Extract BYOK context from headers — never log or persist these values
    const byokKey = req.headers.get("X-BYOK-Key");
    const byokBaseUrl = req.headers.get("X-BYOK-BaseURL");
    const byok: ByokContext | undefined = byokKey
      ? { apiKey: byokKey, baseUrl: byokBaseUrl ?? undefined }
      : undefined;

    // Run the optimized pipeline
    const result = await runOptimizedPipeline(prompt, byok);

    // Return response (note: we don't include the raw routingConfidence value
    // in the response — just a disclaimer note so callers know what it is)
    return NextResponse.json({
      answer: result.answer,
      tokensIn: result.totalTokensIn,
      tokensOut: result.totalTokensOut,
      latencyMs: result.latencyMs,
      tierUsed: result.tierUsed,
      intentCategory: result.intentCategory,
      wasDecomposed: result.wasDecomposed,
      subtaskCount: result.subtaskCount,
      degraded: result.degraded,
      routingConfidenceNote:
        "Routing confidence is an internal heuristic used for cascade escalation only. It is not a validated accuracy measure.",
    });
  } catch (err) {
    console.error("[/api/optimize]", err);
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
