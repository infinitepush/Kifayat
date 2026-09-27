"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

// ─── Types ────────────────────────────────────────────────────────────────

interface CompareResult {
  naive: {
    answer: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
  };
  optimized: {
    answer: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
    tierUsed: number;
    intentCategory: string;
    wasDecomposed: boolean;
    degraded: boolean;
  };
  qualityPreservation: number;
  tokenSavingsPct: number;
  costSavingsPct: number;
}

interface RunRecord {
  id: string;
  createdAt: string;
  prompt: string;
  naiveTokensIn: number;
  naiveTokensOut: number;
  naiveCostUsd: number;
  naiveLatencyMs: number;
  optimizedTokensIn: number;
  optimizedTokensOut: number;
  optimizedCostUsd: number;
  optimizedLatencyMs: number;
  tierUsed: number;
  intentCategory: string;
  wasDecomposed: boolean;
  degraded: boolean;
  qualityPreservation: number;
  tokenSavingsPct: number;
  costSavingsPct: number;
}

interface AggregateStats {
  totalRuns: number;
  avgTokenSavingsPct: number;
  avgCostSavingsPct: number;
  avgQualityPreservation: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const TIER_LABELS: Record<number, string> = {
  0: "Tier 0 · Heuristic",
  1: "Tier 1 · Cheap",
  2: "Tier 2 · Strong",
  3: "Tier 3 · Fallback",
};

const TIER_BADGE_CLASS: Record<number, string> = {
  0: "badge badge--cyan",
  1: "badge badge--green",
  2: "badge badge--amber",
  3: "badge badge--red",
};

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function qualityColor(score: number): string {
  if (score >= 0.9) return "var(--accent-success)";
  if (score >= 0.75) return "var(--accent-warn)";
  return "var(--accent-danger)";
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function KifayatDashboard() {
  const [prompt, setPrompt] = useState("");
  const [byokKey, setByokKey] = useState("");
  const [showByok, setShowByok] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [aggregates, setAggregates] = useState<AggregateStats | null>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  // ── Fetch run history ───────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs ?? []);
      setAggregates(data.aggregates ?? null);
    } catch {
      // Silent — run history is non-critical
    }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // ── Chart: update when runs change ─────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (runs.length === 0) return;

    const labels = runs
      .slice(0, 15)
      .reverse()
      .map((r, i) => `Run ${i + 1}`);

    const tokenData = runs.slice(0, 15).reverse().map((r) => r.tokenSavingsPct);
    const qualityData = runs
      .slice(0, 15)
      .reverse()
      .map((r) => r.qualityPreservation * 100);

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Token Savings %",
            data: tokenData,
            backgroundColor: "rgba(124, 58, 237, 0.5)",
            borderColor: "rgba(124, 58, 237, 0.9)",
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: "y",
          },
          {
            label: "Quality Preservation %",
            data: qualityData,
            backgroundColor: "rgba(16, 185, 129, 0.2)",
            borderColor: "rgba(16, 185, 129, 0.8)",
            borderWidth: 2,
            type: "line",
            tension: 0.4,
            pointRadius: 4,
            yAxisID: "y",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: "#a09cbd",
              font: { family: "Inter", size: 12 },
              boxWidth: 12,
            },
          },
          tooltip: {
            backgroundColor: "rgba(17, 17, 24, 0.95)",
            borderColor: "rgba(124, 58, 237, 0.4)",
            borderWidth: 1,
            titleColor: "#f1f0ff",
            bodyColor: "#a09cbd",
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#5a5570", font: { size: 11 } },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: {
              color: "#5a5570",
              font: { size: 11 },
              callback: (v) => `${v}%`,
            },
          },
        },
      },
    });

    return () => {
      chartInstance.current?.destroy();
    };
  }, [runs]);

  // ── Submit handler ──────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (byokKey.trim()) {
        headers["X-BYOK-Key"] = byokKey.trim();
      }

      const res = await fetch("/api/compare", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }

      setResult(data as CompareResult);
      fetchRuns(); // Refresh run history
    } catch (err) {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Navigation ── */}
      <nav className="navbar">
        <div className="navbar__inner">
          <div className="navbar__logo">
            Kifayat
            <span>LLM Cost Optimization Engine</span>
          </div>
          <div className="flex gap-3 items-center">
            <a
              href="https://github.com"
              className="btn btn--ghost text-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>

      <main>
        {/* ── Hero ── */}
        <section style={{ padding: "3rem 0 2rem" }}>
          <div className="container--narrow">
            <div style={{ marginBottom: "0.5rem" }}>
              <span className="badge badge--violet">Open Source · MIT</span>
            </div>
            <h1 style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
              Prove every token saved{" "}
              <span style={{ color: "var(--accent-glow)" }}>doesn't cost quality</span>
            </h1>
            <p style={{ fontSize: "1.05rem", maxWidth: "540px" }}>
              Kifayat sits between your prompt and the LLM API. It compresses,
              routes, and optimizes — then shows you the numbers side by side.
            </p>
          </div>
        </section>

        {/* ── Aggregate Stats ── */}
        {aggregates && aggregates.totalRuns > 0 && (
          <section style={{ padding: "0 0 2rem" }}>
            <div className="container--narrow">
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-card__value">{aggregates.totalRuns}</div>
                  <div className="stat-card__label">Total Runs</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__value">
                    {aggregates.avgTokenSavingsPct.toFixed(1)}%
                  </div>
                  <div className="stat-card__label">Avg Token Savings</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__value">
                    {aggregates.avgCostSavingsPct.toFixed(1)}%
                  </div>
                  <div className="stat-card__label">Avg Cost Savings</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__value">
                    {(aggregates.avgQualityPreservation * 100).toFixed(1)}%
                  </div>
                  <div className="stat-card__label">Avg Quality Score</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Compare Form ── */}
        <section style={{ padding: "0 0 2rem" }}>
          <div className="container--narrow">
            <div className="card card--glow">
              <h2 style={{ marginBottom: "1rem" }}>Try it live</h2>
              <form id="compare-form" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="prompt-input">
                    Your prompt
                  </label>
                  <textarea
                    id="prompt-input"
                    className="form-textarea"
                    rows={4}
                    placeholder="Ask anything — math, code, summarization, general Q&A…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>

                {/* BYOK toggle */}
                <div style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="btn btn--ghost text-sm"
                    onClick={() => setShowByok((v) => !v)}
                  >
                    {showByok ? "▾" : "▸"} BYOK API Key{" "}
                    <span className="text-muted">
                      (optional — for Tier 2 strong model)
                    </span>
                  </button>

                  {showByok && (
                    <div className="form-group" style={{ marginTop: "0.5rem" }}>
                      <input
                        id="byok-key-input"
                        type="password"
                        className="form-input"
                        placeholder="sk-… (never stored server-side)"
                        value={byokKey}
                        onChange={(e) => setByokKey(e.target.value)}
                      />
                      <p
                        className="text-xs text-muted"
                        style={{ marginTop: "0.25rem" }}
                      >
                        Your key is sent in a request header only. It is never
                        logged, stored, or persisted.
                      </p>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: "1rem",
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "center",
                  }}
                >
                  <button
                    id="submit-compare"
                    type="submit"
                    className={`btn btn--primary ${loading ? "btn--loading" : ""}`}
                    disabled={loading || !prompt.trim()}
                  >
                    {!loading && "Compare Naive vs Optimized →"}
                  </button>
                  {loading && (
                    <span className="text-sm text-muted">Running both paths…</span>
                  )}
                </div>
              </form>
            </div>
          </div>
        </section>

        {/* ── Error ── */}
        {error && (
          <section style={{ padding: "0 0 1.5rem" }}>
            <div className="container--narrow">
              <div className="alert alert--error">{error}</div>
            </div>
          </section>
        )}

        {/* ── Results ── */}
        {result && (
          <section className="animate-in" style={{ padding: "0 0 2rem" }}>
            <div className="container--narrow">
              {/* Headline savings */}
              <div
                className="card"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(16,185,129,0.06))",
                  marginBottom: "1rem",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: "1.5rem",
                    alignItems: "center",
                  }}
                >
                  {/* Quality */}
                  <div>
                    <div
                      style={{
                        fontSize: "2.2rem",
                        fontWeight: 700,
                        color: qualityColor(result.qualityPreservation),
                        letterSpacing: "-0.03em",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {(result.qualityPreservation * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: "0.2rem" }}>
                      Quality Preserved
                    </div>
                    <div
                      className="score-bar"
                      style={{ marginTop: "0.4rem" }}
                      title="Cosine similarity of answer embeddings vs naive baseline"
                    >
                      <div
                        className="score-bar__fill"
                        style={{ width: `${result.qualityPreservation * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Token savings */}
                  <div>
                    <div
                      style={{
                        fontSize: "2.2rem",
                        fontWeight: 700,
                        color: "var(--accent-glow)",
                        letterSpacing: "-0.03em",
                      }}
                    >
                      {result.tokenSavingsPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: "0.2rem" }}>
                      Token Reduction
                    </div>
                  </div>

                  {/* Cost savings */}
                  <div>
                    <div
                      style={{
                        fontSize: "2.2rem",
                        fontWeight: 700,
                        color: "var(--accent-success)",
                        letterSpacing: "-0.03em",
                      }}
                    >
                      {result.costSavingsPct.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: "0.2rem" }}>
                      Cost Reduction
                    </div>
                  </div>

                  {/* Tier used */}
                  <div>
                    <span
                      className={
                        TIER_BADGE_CLASS[result.optimized.tierUsed] ??
                        "badge badge--violet"
                      }
                    >
                      {TIER_LABELS[result.optimized.tierUsed]}
                    </span>
                    <div className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
                      Intent:{" "}
                      <span style={{ color: "var(--text-primary)" }}>
                        {result.optimized.intentCategory}
                      </span>
                    </div>
                    {result.optimized.wasDecomposed && (
                      <div className="text-xs" style={{ color: "var(--accent-secondary)", marginTop: "0.2rem" }}>
                        ⚡ Decomposed query
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted" style={{ marginTop: "1rem" }}>
                  Quality score is cosine similarity of answer embeddings vs the unoptimized strong-model response.
                  It measures semantic preservation, not factual correctness.
                </p>
              </div>

              {/* Side-by-side answers */}
              <div className="compare-grid">
                {/* Naive panel */}
                <div className="compare-panel compare-panel--naive">
                  <div className="compare-panel__label">Naive (Unoptimized)</div>
                  <div className="compare-panel__answer">{result.naive.answer}</div>
                  <div className="compare-panel__metrics">
                    <div className="metric">
                      <span className="metric__value">
                        {formatTokens(result.naive.tokensIn + result.naive.tokensOut)}
                      </span>
                      <span className="metric__label">Total Tokens</span>
                    </div>
                    <div className="metric">
                      <span className="metric__value">
                        {formatCost(result.naive.costUsd)}
                      </span>
                      <span className="metric__label">Est. Cost</span>
                    </div>
                    <div className="metric">
                      <span className="metric__value">
                        {formatMs(result.naive.latencyMs)}
                      </span>
                      <span className="metric__label">Latency</span>
                    </div>
                    <div className="metric">
                      <span className="metric__value text-muted">
                        {formatTokens(result.naive.tokensIn)}
                        {" / "}
                        {formatTokens(result.naive.tokensOut)}
                      </span>
                      <span className="metric__label">In / Out</span>
                    </div>
                  </div>
                </div>

                {/* Optimized panel */}
                <div className="compare-panel compare-panel--optimized">
                  <div className="compare-panel__label">Optimized (Kifayat)</div>
                  <div className="compare-panel__answer">
                    {result.optimized.answer}
                    {result.optimized.degraded && (
                      <div
                        className="alert alert--warn"
                        style={{ marginTop: "0.75rem", fontSize: "0.78rem" }}
                      >
                        ⚠ Degraded — no tier cleared the confidence threshold
                      </div>
                    )}
                  </div>
                  <div className="compare-panel__metrics">
                    <div className="metric">
                      <span className="metric__value text-success">
                        {formatTokens(
                          result.optimized.tokensIn + result.optimized.tokensOut
                        )}
                      </span>
                      <span className="metric__label">Total Tokens</span>
                    </div>
                    <div className="metric">
                      <span className="metric__value text-success">
                        {formatCost(result.optimized.costUsd)}
                      </span>
                      <span className="metric__label">Est. Cost</span>
                    </div>
                    <div className="metric">
                      <span className="metric__value">
                        {formatMs(result.optimized.latencyMs)}
                      </span>
                      <span className="metric__label">Latency</span>
                    </div>
                    <div className="metric">
                      <span className="metric__value text-muted">
                        {formatTokens(result.optimized.tokensIn)}
                        {" / "}
                        {formatTokens(result.optimized.tokensOut)}
                      </span>
                      <span className="metric__label">In / Out</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Chart ── */}
        {runs.length > 0 && (
          <section style={{ padding: "0 0 2rem" }}>
            <div className="container--narrow">
              <div className="card">
                <h3 style={{ marginBottom: "1rem" }}>
                  Token Savings vs Quality Preservation
                </h3>
                <div style={{ height: "220px", position: "relative" }}>
                  <canvas ref={chartRef} />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Run History Table ── */}
        {runs.length > 0 && (
          <section style={{ padding: "0 0 4rem" }}>
            <div className="container">
              <h2 style={{ marginBottom: "1rem" }}>Run History</h2>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Prompt</th>
                      <th>Intent</th>
                      <th>Tier</th>
                      <th>Token Savings</th>
                      <th>Cost Savings</th>
                      <th>Quality</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td className="td-prompt" title={run.prompt}>
                          {run.prompt}
                        </td>
                        <td>
                          <span className="badge badge--violet">
                            {run.intentCategory}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              TIER_BADGE_CLASS[run.tierUsed] ?? "badge badge--violet"
                            }
                          >
                            T{run.tierUsed}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`savings-pill ${
                              run.tokenSavingsPct >= 0
                                ? "savings-pill--positive"
                                : "savings-pill--negative"
                            }`}
                          >
                            {formatPct(run.tokenSavingsPct)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`savings-pill ${
                              run.costSavingsPct >= 0
                                ? "savings-pill--positive"
                                : "savings-pill--negative"
                            }`}
                          >
                            {formatPct(run.costSavingsPct)}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              color: qualityColor(run.qualityPreservation),
                              fontWeight: 600,
                              fontSize: "0.85rem",
                            }}
                          >
                            {(run.qualityPreservation * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-muted">
                          {new Date(run.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
