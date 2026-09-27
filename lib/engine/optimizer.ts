/**
 * Kifayat Engine — Prompt Optimizer
 *
 * Applies two kinds of optimization:
 *
 * INPUT side:
 *   - Strips filler phrases ("I hope this message finds you well", "Please note that", etc.)
 *   - Collapses excess whitespace/newlines
 *   - Truncates + summarizes pasted context above TOKEN_SUMMARY_THRESHOLD
 *     (summary is done by the cascade's cheap tier itself — we send the text
 *     to the Groq cheap model with a "summarize in N words" prompt)
 *
 * OUTPUT side:
 *   - Injects a per-intent specialised system prompt that forces concise,
 *     structured output (inspired by THRIFT's _build_specialized_prompt pattern)
 *   - Sets a hard max_tokens cap per intent category
 *
 * Ported from THRIFT's tiers.py pattern into TypeScript.
 */

import type { IntentCategory, OptimizedPrompt } from "./types";

// ---------------------------------------------------------------------------
// Filler patterns to strip from input (output tokens cost ~5–6x input)
// ---------------------------------------------------------------------------

const FILLER_PATTERNS: RegExp[] = [
  // Pleasantries and preambles
  /I hope (this message |this email |you are )?(finds you well|finds you in good health|is finding you well)[.,]?\s*/gi,
  /please note that\s*/gi,
  /as (an AI|a language model|ChatGPT|GPT),?\s*I (want to |would like to )?(clarify|note|remind you|let you know)[^.]*\.\s*/gi,
  /feel free to (ask|let me know|reach out)[^.]*\.\s*/gi,
  /I('d| would) be happy to help( you| with that)?[^.]*\.\s*/gi,
  /certainly[!,]?\s+/gi,
  /of course[!,]?\s+/gi,
  /sure[!,]?\s+(?=I|let|here|below)/gi,
  /^(hello|hi|hey)[!,.]?\s*/gi,
  /thank you for (your question|asking|reaching out)[^.]*\.\s*/gi,
  /\s{2,}/g, // collapse multiple spaces
];

// ---------------------------------------------------------------------------
// Per-intent system prompts (OUTPUT optimisation)
// These force the model to return only the essential content.
// Heavily inspired by THRIFT's _build_specialized_prompt / _post_process_answer.
// ---------------------------------------------------------------------------

const INTENT_SYSTEM_PROMPTS: Record<IntentCategory, string> = {
  math: `You are a precise mathematical solver.
Rules:
- State the final answer FIRST, then the working (if working is needed).
- Use numbers and symbols, not prose. No preambles.
- If the answer is a single number, return ONLY that number, nothing else.
- Example format: "Answer: 42" or "42" — not "The answer to this problem is 42."`,

  code: `You are a precise code generator.
Rules:
- Return ONLY the code block, no explanation before or after unless explicitly asked.
- Use triple-backtick fences with the language name.
- No "Here is the code:" preambles. Start the code fence immediately.
- After the code, you MAY add ONE short sentence of explanation if it adds real value.`,

  summarization: `You are a concise summariser.
Rules:
- Return the summary ONLY. No "Here is a summary:" or "In this text..." preambles.
- Use bullet points if the source has multiple distinct points; otherwise one paragraph.
- Maximum 3 bullet points or 80 words unless asked for more.`,

  sentiment: `You are a sentiment classifier.
Rules:
- Return exactly ONE word: Positive, Negative, or Neutral.
- Nothing else. No explanation, no punctuation beyond the single word.
- If genuinely ambiguous, return "Mixed".`,

  factual: `You are a concise factual assistant.
Rules:
- Answer directly in 1–3 sentences. No preambles, no "Great question!"
- If you don't know, say "I don't know" — do not guess.
- Citations are not required unless explicitly asked.`,

  creative: `You are a creative writing assistant.
Rules:
- Produce the creative output directly. No "Sure, here is a poem:" preambles.
- Start with the creative content immediately.
- Keep to the requested format/length unless none is specified (default: concise).`,

  reasoning: `You are a logical reasoning assistant.
Rules:
- Think step-by-step, but label each step clearly (Step 1:, Step 2:, etc.)
- State the final conclusion clearly at the end, prefixed with "Conclusion:".
- Avoid unnecessary padding between steps.`,

  extraction: `You are a precise information extractor.
Rules:
- Return extracted information as a structured JSON array or bulleted list.
- No preambles. Start with the extracted data immediately.
- If nothing matches, return an empty array [] or "None found."`,

  translation: `You are a precise translator.
Rules:
- Return ONLY the translated text. No "Here is the translation:" preambles.
- Preserve formatting (bullets, line breaks) from the original.
- If the target language is ambiguous, ask — otherwise translate directly.`,

  general: `You are a helpful, concise assistant.
Rules:
- Answer directly and concisely. Skip all preambles and pleasantries.
- Do not start with "Certainly!", "Of course!", "Great question!", or similar filler.
- If the question is ambiguous, ask ONE clarifying question rather than guessing.`,
};

// ---------------------------------------------------------------------------
// Max tokens caps per intent (hard cap for OUTPUT optimisation)
// These are conservative defaults; the user can override via API params.
// ---------------------------------------------------------------------------

const INTENT_MAX_TOKENS: Record<IntentCategory, number> = {
  math: 256,
  code: 1024,
  summarization: 512,
  sentiment: 256,
  factual: 256,
  creative: 512,
  reasoning: 768,
  extraction: 512,
  translation: 768,
  general: 512,
};

// ---------------------------------------------------------------------------
// Post-processing — strip chain-of-thought preamble from raw model output
// ---------------------------------------------------------------------------

const PREAMBLE_PATTERNS: RegExp[] = [
  /<thought>[\s\S]*?<\/thought>/gi,
  /^(certainly|of course|sure)[!,.]?\s*/i,
  /^(great question|good question|excellent question)[!,.]?\s*/i,
  /^I('d| would) (be happy to|love to) help[^.]*\.\s*/i,
  /^(as an AI|as a language model)[^.]*\.\s*/i,
  /^(here is|here's) (the |a |your )(answer|response|solution|code|translation|summary)[^:]*:\s*/i,
  /^(let me|I'll|I will) (help|answer|explain|solve)[^.]*\.\s*/i,
];

export function postProcessAnswer(raw: string, category: IntentCategory): string {
  let text = raw.trim();

  // Strip preambles
  for (const pat of PREAMBLE_PATTERNS) {
    text = text.replace(pat, "");
  }

  // Category-specific cleanup
  if (category === "sentiment") {
    // Return only the first word
    const cleanWord = text.split(/\s+/)[0].replace(/[^a-zA-Z]/g, "").trim();
    const allowed = ["Positive", "Negative", "Neutral", "Mixed"];
    const normalised = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
    return allowed.includes(normalised) ? normalised : text.trim();
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Input trimmer
// ---------------------------------------------------------------------------

const TOKEN_CHARS_ESTIMATE = 4; // rough chars-per-token estimate
const TOKEN_SUMMARY_THRESHOLD = 800; // tokens above this → summarize pasted context

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHARS_ESTIMATE);
}

function stripFillerFromInput(prompt: string): string {
  let result = prompt;
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, pattern.flags.includes("g") ? " " : "");
  }
  return result.trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optimise a single subtask prompt for a given intent category.
 *
 * Does NOT call a model for input summarization at this stage — the cascade
 * handles that as part of Tier 0 if the prompt is very long.
 */
export function optimizePrompt(
  prompt: string,
  category: IntentCategory
): OptimizedPrompt {
  const originalTokens = estimateTokens(prompt);
  const trimmed = stripFillerFromInput(prompt);
  const trimmedTokens = estimateTokens(trimmed);

  return {
    userPrompt: trimmed,
    systemPrompt: INTENT_SYSTEM_PROMPTS[category] ?? INTENT_SYSTEM_PROMPTS.general,
    maxTokens: INTENT_MAX_TOKENS[category] ?? INTENT_MAX_TOKENS.general,
    inputTokensSaved: Math.max(0, originalTokens - trimmedTokens),
  };
}

/**
 * Whether a prompt is long enough to warrant summarization before sending.
 */
export function needsSummarization(prompt: string): boolean {
  return estimateTokens(prompt) > TOKEN_SUMMARY_THRESHOLD;
}

export { INTENT_SYSTEM_PROMPTS, INTENT_MAX_TOKENS };
