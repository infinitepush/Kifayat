/**
 * Kifayat Engine — Classifier
 *
 * Strategy: regex/keyword pass first (zero cost, instant).
 * Falls back to a single cheap-model call ONLY when regex confidence < threshold.
 *
 * DESIGN NOTES:
 * - This is NOT a fixed closed-world task list. Unknown prompts map to "general".
 * - The model-fallback call uses the cheapest possible model to minimise overhead.
 * - The confidence value is for routing purposes only. Do NOT interpret it as
 *   "correctness probability."
 *
 * Inspired by THRIFT's intent classifier but generalised for arbitrary prompts.
 */

import OpenAI from "openai";
import type { ClassificationResult, IntentCategory } from "./types";

// ---------------------------------------------------------------------------
// Regex rules — ordered by specificity (most specific first)
// ---------------------------------------------------------------------------

interface RegexRule {
  pattern: RegExp;
  category: IntentCategory;
  confidence: number;
}

const REGEX_RULES: RegexRule[] = [
  // Math — numbers + operators or explicit math keywords
  {
    pattern:
      /\b(calculate|compute|solve|evaluate|simplify|derivative|integral|equation|algebra|geometry|probability|statistic|percentage|ratio|factorial|prime|sqrt|square root|modulo|logarithm)\b/i,
    category: "math",
    confidence: 0.9,
  },
  {
    // Pure arithmetic expressions like "what is 42 * 7 + (3^2)"
    pattern: /\d[\d\s+\-*/^%().]+[\d)]\s*[=?]?/,
    category: "math",
    confidence: 0.85,
  },

  // Code
  {
    pattern:
      /\b(write|create|implement|generate|code|function|class|algorithm|script|program|debug|fix|refactor|explain this code|what does this code|snippet)\b/i,
    category: "code",
    confidence: 0.85,
  },
  {
    // Presence of code-like characters in the prompt body
    pattern: /```[\s\S]+```|def |function |const |let |var |import |class \w+/,
    category: "code",
    confidence: 0.9,
  },

  // Sentiment
  {
    pattern:
      /\b(sentiment|positive|negative|neutral|emotion|feel|opinion|review|tone)\b.*\b(of|in|this|the|about)\b/i,
    category: "sentiment",
    confidence: 0.9,
  },
  {
    pattern: /what (is|does).{0,30}(feel|sound|tone|sentiment)/i,
    category: "sentiment",
    confidence: 0.85,
  },

  // Summarization
  {
    pattern:
      /\b(summarize|summarise|summary|tldr|tl;dr|brief|concise|shorten|condense|key points|main points|overview)\b/i,
    category: "summarization",
    confidence: 0.9,
  },

  // Translation
  {
    pattern:
      /\b(translate|translation|in (french|spanish|german|hindi|japanese|chinese|arabic|portuguese|italian|russian|korean|urdu))\b/i,
    category: "translation",
    confidence: 0.9,
  },

  // Extraction (NER, parsing, extract info)
  {
    pattern:
      /\b(extract|parse|identify|list all|find all|pull out|entities|keywords|names|dates|emails|phone numbers|from the (text|following|above))\b/i,
    category: "extraction",
    confidence: 0.85,
  },

  // Creative writing
  {
    pattern:
      /\b(write a (poem|story|essay|letter|blog|tweet|caption|joke|lyrics|haiku|limerick|speech|creative)|creative|fiction|imagine|roleplay|pretend)\b/i,
    category: "creative",
    confidence: 0.85,
  },

  // Factual / Q&A
  {
    pattern:
      /\b(what is|who is|when was|where is|how does|define|explain|tell me about|what are the|history of|facts about)\b/i,
    category: "factual",
    confidence: 0.75, // lower confidence because "what is X" could be many things
  },

  // Reasoning / logical
  {
    pattern:
      /\b(reason|reasoning|logic|logical|compare|contrast|pros and cons|advantages|disadvantages|evaluate|analyse|analyze|critique|argument|debate|think through|step by step)\b/i,
    category: "reasoning",
    confidence: 0.8,
  },
];

// Confidence threshold below which we fall back to model classification
const REGEX_CONFIDENCE_THRESHOLD = 0.75;
// Groq model used for the classifier fallback (cheapest available)
const CLASSIFIER_MODEL = "openai/gpt-oss-20b";

// ---------------------------------------------------------------------------
// Regex-first classification
// ---------------------------------------------------------------------------

function classifyWithRegex(prompt: string): {
  category: IntentCategory;
  confidence: number;
} {
  // Trim and normalise whitespace
  const text = prompt.trim().replace(/\s+/g, " ");

  let bestCategory: IntentCategory = "general";
  let bestConfidence = 0;

  for (const rule of REGEX_RULES) {
    if (rule.pattern.test(text) && rule.confidence > bestConfidence) {
      bestCategory = rule.category;
      bestConfidence = rule.confidence;
    }
  }

  return { category: bestCategory, confidence: bestConfidence };
}

// ---------------------------------------------------------------------------
// Model-fallback classification
// ---------------------------------------------------------------------------

import { withRetry } from "./retry";

async function classifyWithModel(
  prompt: string,
  groqClient: OpenAI
): Promise<{ category: IntentCategory; confidence: number }> {
  const systemPrompt = `You are a prompt intent classifier. Classify the user's prompt into exactly ONE of these categories:
math, code, summarization, sentiment, factual, creative, reasoning, extraction, translation, general

Rules:
- Respond with ONLY a JSON object: {"category": "<category>", "confidence": <0.0-1.0>}
- confidence = how sure you are (0.6-1.0 range, never go below 0.6)
- If genuinely unsure, use "general" with confidence 0.65
- No explanation, no other text`;

  try {
    const response = await withRetry(() =>
      groqClient.chat.completions.create({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Classify this prompt: "${prompt.slice(0, 500)}"`,
          },
        ],
        max_tokens: 60,
        temperature: 0,
      })
    );

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    // Extract JSON from the response
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const category = (parsed.category as IntentCategory) ?? "general";
      const confidence = Math.min(1, Math.max(0.6, parsed.confidence ?? 0.65));
      return { category, confidence };
    }
  } catch (err) {
    // Model call failed — fall back to "general" safely
    console.warn("[classifier] model fallback failed, defaulting to general:", err);
  }

  return { category: "general", confidence: 0.6 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the intent of a prompt.
 *
 * Process:
 * 1. Try regex rules (free, instant).
 * 2. If confidence < threshold, make ONE cheap model call.
 *
 * @param prompt - The user prompt to classify.
 * @param groqClient - An OpenAI-compatible client pointed at Groq.
 */
export async function classifyIntent(
  prompt: string,
  groqClient: OpenAI
): Promise<ClassificationResult> {
  if (!prompt?.trim()) {
    return { category: "general", confidence: 1.0, usedModelFallback: false };
  }

  const regexResult = classifyWithRegex(prompt);

  if (regexResult.confidence >= REGEX_CONFIDENCE_THRESHOLD) {
    return {
      category: regexResult.category,
      confidence: regexResult.confidence,
      usedModelFallback: false,
    };
  }

  // Regex wasn't confident enough — call the cheap model
  const modelResult = await classifyWithModel(prompt, groqClient);
  return {
    category: modelResult.category,
    confidence: modelResult.confidence,
    usedModelFallback: true,
  };
}
