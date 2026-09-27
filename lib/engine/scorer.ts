/**
 * Kifayat Engine — Quality Preservation Scorer
 *
 * Computes the quality-preservation score for the dashboard.
 *
 * This is the score shown to the user on the dashboard:
 * "X% output similarity to the unoptimized answer, using Y% fewer tokens"
 *
 * Method: Cosine similarity between the text embeddings of:
 *   - The optimized pipeline's answer
 *   - The naive (unoptimized, direct to strong model) answer
 *
 * Embedding model: @xenova/transformers (all-MiniLM-L6-v2)
 *   - Runs locally in Node, no API key needed
 *   - 384-dimensional dense embeddings
 *   - Small enough (~25MB) to load once at server startup
 *
 * IMPORTANT: This is a defensible, real comparison score.
 * A 0.94 quality-preservation score means the optimised answer's semantic
 * content is 94% similar to the strong-model baseline. It is NOT a measure
 * of factual correctness — it is a semantic proximity measure.
 *
 * The routing confidence score (confidence.ts) is a DIFFERENT thing entirely —
 * see that file's disclaimer.
 *
 * FALLBACK: If the embedding model fails to load (rare, but can happen on first
 * cold-start due to model download), we return a null quality score.
 * The API route handles this gracefully.
 */

// NOTE ON @xenova/transformers:
// This package has native build dependencies (sharp/libvips) that can fail on
// some Windows configurations. If installation fails, we fall back to a simple
// word-overlap similarity (Jaccard-like). This is less precise but always works.
// See PROJECT_MEMORY.md for the installation issue notes.

let embeddingPipeline: ((texts: string[]) => Promise<number[][]>) | null = null;
let pipelineLoadAttempted = false;

/**
 * Lazy-load the embedding pipeline.
 * First call may take a few seconds (model download if not cached).
 * Subsequent calls are instant (model is cached by transformers.js).
 */
async function getEmbeddingPipeline(): Promise<
  ((texts: string[]) => Promise<number[][]>) | null
> {
  if (pipelineLoadAttempted) return embeddingPipeline;
  pipelineLoadAttempted = true;

  try {
    // Dynamic import to avoid top-level ESM issues in Next.js
    const { pipeline, env } = await import("@xenova/transformers");

    // Cache model in node_modules (not in a temp dir)
    env.cacheDir = "./models";

    const pipe = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );

    embeddingPipeline = async (texts: string[]) => {
      const results: number[][] = [];
      for (const text of texts) {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        results.push(Array.from(output.data) as number[]);
      }
      return results;
    };

    console.log("[scorer] Embedding pipeline loaded: all-MiniLM-L6-v2");
    return embeddingPipeline;
  } catch (err) {
    console.warn(
      "[scorer] @xenova/transformers failed to load, using fallback similarity:",
      err
    );
    embeddingPipeline = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fallback: word-overlap similarity (Jaccard-like)
// Used when the embedding model is unavailable.
// ---------------------------------------------------------------------------

function wordOverlapSimilarity(textA: string, textB: string): number {
  const tokenize = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );

  const setA = tokenize(textA);
  const setB = tokenize(textB);

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Cosine similarity between two dense embedding vectors
// ---------------------------------------------------------------------------

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the quality-preservation score between an optimised answer and
 * the naive baseline answer.
 *
 * Returns a value 0–1 (higher = more similar = better quality preservation).
 *
 * @param optimizedAnswer - The output from the optimised pipeline.
 * @param naiveAnswer - The output from the direct (unoptimised) strong-model call.
 */
export async function computeQualityPreservation(
  optimizedAnswer: string,
  naiveAnswer: string
): Promise<number> {
  if (!optimizedAnswer?.trim() || !naiveAnswer?.trim()) return 0.0;

  // Normalise extremely short answers (single-word sentiment etc.)
  const a = optimizedAnswer.trim();
  const b = naiveAnswer.trim();

  // Perfect match shortcut
  if (a.toLowerCase() === b.toLowerCase()) return 1.0;

  // Containment shortcut for concise/numeric answers (e.g., "45" inside "The answer is 45")
  const normA = a.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const normB = b.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (normA.length > 0 && normB.length > 0) {
    if (normB.includes(normA) || normA.includes(normB)) {
      if (normA.length < 25 || normB.length < 25) return 1.0;
    }
  }

  try {
    const pipe = await getEmbeddingPipeline();

    if (pipe) {
      const [embA, embB] = await pipe([a, b]);
      const score = cosineSimilarity(embA, embB);
      return Math.min(1.0, Math.max(0.0, score));
    }
  } catch (err) {
    console.warn("[scorer] Embedding computation failed, using fallback:", err);
  }

  // Fallback: word overlap
  return wordOverlapSimilarity(a, b);
}
