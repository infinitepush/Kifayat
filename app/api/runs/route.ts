/**
 * GET /api/runs
 *
 * Returns paginated run history for the dashboard.
 *
 * Query params:
 *   page=1 (1-indexed)
 *   limit=20
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const skip = (page - 1) * limit;

    const [runs, total] = await Promise.all([
      prisma.queryRun.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          prompt: true,
          naiveTokensIn: true,
          naiveTokensOut: true,
          naiveCostUsd: true,
          naiveLatencyMs: true,
          optimizedTokensIn: true,
          optimizedTokensOut: true,
          optimizedCostUsd: true,
          optimizedLatencyMs: true,
          tierUsed: true,
          intentCategory: true,
          wasDecomposed: true,
          degraded: true,
          qualityPreservation: true,
          tokenSavingsPct: true,
          costSavingsPct: true,
        },
      }),
      prisma.queryRun.count(),
    ]);

    // Aggregate stats for the dashboard
    const stats = await prisma.queryRun.aggregate({
      _avg: {
        tokenSavingsPct: true,
        costSavingsPct: true,
        qualityPreservation: true,
      },
      _count: {
        id: true,
      },
    });

    return NextResponse.json({
      runs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      aggregates: {
        totalRuns: stats._count.id,
        avgTokenSavingsPct: stats._avg.tokenSavingsPct ?? 0,
        avgCostSavingsPct: stats._avg.costSavingsPct ?? 0,
        avgQualityPreservation: stats._avg.qualityPreservation ?? 0,
      },
    });
  } catch (err) {
    console.error("[/api/runs]", err);
    return NextResponse.json(
      { error: "Failed to fetch run history" },
      { status: 500 }
    );
  }
}
