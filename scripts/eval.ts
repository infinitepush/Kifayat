/**
 * Kifayat — Benchmark Evaluation Script
 *
 * Usage: npm run eval
 *
 * Runs 15–20 varied benchmark prompts through the Kifayat optimization pipeline,
 * comparing them against naive baselines, and produces headline numbers:
 *
 *   - Average token savings %
 *   - Average quality-preservation score
 *   - Tier usage breakdown
 *   - Per-category breakdown
 *
 * Output is printed to stdout and saved to benchmark-results.json.
 *
 * IMPORTANT: This script requires GROQ_API_KEY to be set in the environment.
 * Run `cp .env.local.example .env.local` and fill in your key first.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Load .env.local manually since we're running outside Next.js
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
}

import { runOptimizedPipeline, runNaivePipeline, estimateCostUsd } from "../lib/engine/pipeline";
import { computeQualityPreservation } from "../lib/engine/scorer";

// ─── Benchmark Prompts ────────────────────────────────────────────────────

const BENCHMARK_PROMPTS = [
  // Math
  { id: "math-1", prompt: "What is 847 * 23 + 1500?", category: "math" },
  { id: "math-2", prompt: "Calculate the square root of 2025.", category: "math" },
  { id: "math-3", prompt: "What is 15% of 240?", category: "math" },

  // Code
  { id: "code-1", prompt: "Write a Python function to check if a number is prime.", category: "code" },
  { id: "code-2", prompt: "Write a TypeScript function that debounces a callback by N milliseconds.", category: "code" },

  // Sentiment
  { id: "sent-1", prompt: "What is the sentiment of this review: 'The product broke after one day. Terrible quality, would not recommend.'", category: "sentiment" },
  { id: "sent-2", prompt: "Sentiment of: 'Absolutely fantastic service! Exceeded all my expectations.'", category: "sentiment" },

  // Summarization
  { id: "summ-1", prompt: "Summarize the concept of entropy in thermodynamics in 2 sentences.", category: "summarization" },
  { id: "summ-2", prompt: "Give me a brief summary of how transformers work in machine learning.", category: "summarization" },

  // Factual
  { id: "fact-1", prompt: "What is the capital of Australia?", category: "factual" },
  { id: "fact-2", prompt: "Who invented the telephone?", category: "factual" },
  { id: "fact-3", prompt: "What does HTTP stand for?", category: "factual" },

  // Reasoning
  { id: "reas-1", prompt: "Compare the pros and cons of using SQLite vs PostgreSQL for a portfolio project.", category: "reasoning" },

  // Creative
  { id: "crea-1", prompt: "Write a haiku about optimization.", category: "creative" },

  // Compound (tests decomposer)
  { id: "comp-1", prompt: "1. What is the speed of light? 2. What is the mass of an electron?", category: "compound" },
  { id: "comp-2", prompt: "Define machine learning and explain what overfitting means.", category: "compound" },

  // General
  { id: "gen-1", prompt: "What are three good practices for writing clean code?", category: "general" },
  { id: "gen-2", prompt: "Explain why recursion can be dangerous if not handled carefully.", category: "general" },
];

// ─── Runner ───────────────────────────────────────────────────────────────

interface BenchmarkResult {
  id: string;
  category: string;
  prompt: string;
  naiveTokens: number;
  naiveCostUsd: number;
  naiveLatencyMs: number;
  optimizedTokens: number;
  optimizedCostUsd: number;
  optimizedLatencyMs: number;
  tierUsed: number;
  intentDetected: string;
  wasDecomposed: boolean;
  qualityPreservation: number;
  tokenSavingsPct: number;
  costSavingsPct: number;
  error?: string;
}

async function runBenchmark(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Kifayat Benchmark Evaluation                  ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  if (!process.env.GROQ_API_KEY) {
    console.error("ERROR: GROQ_API_KEY is not set. Copy .env.local.example → .env.local and add your key.");
    process.exit(1);
  }

  const results: BenchmarkResult[] = [];
  const tierCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (let i = 0; i < BENCHMARK_PROMPTS.length; i++) {
    const { id, prompt, category } = BENCHMARK_PROMPTS[i];
    process.stdout.write(`[${i + 1}/${BENCHMARK_PROMPTS.length}] ${id}... `);

    try {
      // Run sequentially to prevent bursting rate limits
      const naive = await runNaivePipeline(prompt);
      await new Promise((r) => setTimeout(r, 1000));
      const optimized = await runOptimizedPipeline(prompt);

      const qualityPreservation = await computeQualityPreservation(
        optimized.answer,
        naive.answer
      );

      const naiveTokens = naive.tokensIn + naive.tokensOut;
      const optimizedTokens = optimized.totalTokensIn + optimized.totalTokensOut;
      const tokenSavingsPct =
        naiveTokens > 0 ? ((naiveTokens - optimizedTokens) / naiveTokens) * 100 : 0;

      const optimizedCostUsd = estimateCostUsd(
        ["openai/gpt-oss-20b", "openai/gpt-oss-20b", "gpt-4o-mini", "openai/gpt-oss-20b"][optimized.tierUsed],
        optimized.totalTokensIn,
        optimized.totalTokensOut
      );
      const costSavingsPct =
        naive.costUsd > 0
          ? ((naive.costUsd - optimizedCostUsd) / naive.costUsd) * 100
          : 0;

      tierCounts[optimized.tierUsed] = (tierCounts[optimized.tierUsed] ?? 0) + 1;

      results.push({
        id,
        category,
        prompt,
        naiveTokens,
        naiveCostUsd: naive.costUsd,
        naiveLatencyMs: naive.latencyMs,
        optimizedTokens,
        optimizedCostUsd,
        optimizedLatencyMs: optimized.latencyMs,
        tierUsed: optimized.tierUsed,
        intentDetected: optimized.intentCategory,
        wasDecomposed: optimized.wasDecomposed,
        qualityPreservation,
        tokenSavingsPct,
        costSavingsPct,
      });

      console.log(
        `✓  Tier${optimized.tierUsed} · ${tokenSavingsPct.toFixed(1)}% tokens saved · ${(qualityPreservation * 100).toFixed(1)}% quality`
      );

      // Pacing delay to stay cleanly within Groq free tier rate limits (30 RPM / 8000 TPM)
      await new Promise((r) => setTimeout(r, 2500));
    } catch (err) {
      const errorMsg = String(err);
      console.error(`✗  ERROR: ${errorMsg.slice(0, 80)}`);
      results.push({
        id,
        category,
        prompt,
        naiveTokens: 0,
        naiveCostUsd: 0,
        naiveLatencyMs: 0,
        optimizedTokens: 0,
        optimizedCostUsd: 0,
        optimizedLatencyMs: 0,
        tierUsed: 3,
        intentDetected: "unknown",
        wasDecomposed: false,
        qualityPreservation: 0,
        tokenSavingsPct: 0,
        costSavingsPct: 0,
        error: errorMsg,
      });
    }
  }

  // ── Aggregate stats ──────────────────────────────────────────────────────
  const successful = results.filter((r) => !r.error);
  const avgTokenSavings =
    successful.reduce((s, r) => s + r.tokenSavingsPct, 0) / successful.length;
  const avgCostSavings =
    successful.reduce((s, r) => s + r.costSavingsPct, 0) / successful.length;
  const avgQuality =
    successful.reduce((s, r) => s + r.qualityPreservation, 0) / successful.length;

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   Results Summary                               ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Prompts run    : ${results.length}`);
  console.log(`  Successful     : ${successful.length}`);
  console.log(`  Avg token savings  : ${avgTokenSavings.toFixed(2)}%`);
  console.log(`  Avg cost savings   : ${avgCostSavings.toFixed(2)}%`);
  console.log(`  Avg quality score  : ${(avgQuality * 100).toFixed(2)}%`);
  console.log("\n  Tier usage breakdown:");
  Object.entries(tierCounts).forEach(([tier, count]) => {
    const pct = ((count / results.length) * 100).toFixed(1);
    console.log(`    Tier ${tier}: ${count} (${pct}%)`);
  });

  // Per-category breakdown
  const byCategory: Record<string, BenchmarkResult[]> = {};
  for (const r of successful) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }

  console.log("\n  Per-category quality scores:");
  for (const [cat, catResults] of Object.entries(byCategory)) {
    const avgCatQuality =
      catResults.reduce((s, r) => s + r.qualityPreservation, 0) / catResults.length;
    console.log(`    ${cat.padEnd(16)}: ${(avgCatQuality * 100).toFixed(1)}%`);
  }

  // ── Save results ──────────────────────────────────────────────────────────
  const output = {
    runAt: new Date().toISOString(),
    summary: {
      totalPrompts: results.length,
      successfulPrompts: successful.length,
      avgTokenSavingsPct: avgTokenSavings,
      avgCostSavingsPct: avgCostSavings,
      avgQualityPreservation: avgQuality,
      tierUsageBreakdown: tierCounts,
    },
    results,
  };

  const outPath = path.join(process.cwd(), "benchmark-results.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n  Results saved to: ${outPath}`);
  console.log("══════════════════════════════════════════════════\n");
}

runBenchmark().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
