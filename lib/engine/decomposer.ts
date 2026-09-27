/**
 * Kifayat Engine — Decomposer
 *
 * Conservative query splitting. Philosophy (ported from THRIFT's decomposer.py):
 * A bad split is WORSE than no split. Only split when we are SURE the parts are
 * independent and can be answered separately without losing context.
 *
 * Split signals (in order of confidence):
 * 1. Numbered list of questions (e.g. "1. What is X? 2. How does Y work?")
 * 2. Semicolons separating clearly distinct clauses
 * 3. "and" joining two grammatically complete, different-intent sentences
 *
 * We do NOT split:
 * - Single sentences
 * - "X and Y" where Y depends on X ("calculate 5 + 3 and then multiply by 2")
 * - Ambiguous "and" clauses that share the same subject/verb
 */

import type { DecomposedQuery } from "./types";

// ---------------------------------------------------------------------------
// Numbered list detection
// ---------------------------------------------------------------------------

const NUMBERED_ITEM_RE = /(?:^|\n)\s*(?:\d+[.):])\s+(.+?)(?=\n\s*\d+[.):]|\n*$)/gs;

function splitByNumberedList(prompt: string): string[] | null {
  const matches = [...prompt.matchAll(NUMBERED_ITEM_RE)];
  if (matches.length >= 2) {
    const subtasks = matches.map((m) => m[1].trim()).filter(Boolean);
    if (subtasks.length >= 2) return subtasks;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Semicolon detection
// ---------------------------------------------------------------------------

function splitBySemicolon(prompt: string): string[] | null {
  // Only split if there are actual full clauses separated by semicolons
  const parts = prompt
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 10); // ignore empty or very short fragments

  if (parts.length >= 2) {
    // Each part should look like a standalone clause (contain a verb or question word)
    const allLookIndependent = parts.every((p) =>
      /\b(is|are|was|were|do|does|did|can|could|would|should|will|what|how|why|when|where|who|explain|calculate|define|write|summarize|list|tell)\b/i.test(
        p
      )
    );
    if (allLookIndependent) return parts;
  }
  return null;
}

// ---------------------------------------------------------------------------
// "and" joining different-intent sentences
// ---------------------------------------------------------------------------

// Words that signal dependency — if present, do NOT split
const DEPENDENCY_SIGNALS = [
  /then\s+(use|apply|multiply|divide|add|subtract|calculate|convert)/i,
  /\band\s+(?:then|also\s+)?(?:use|apply)\s+(?:that|this|it|them)/i,
  /result|answer|output/i, // sharing a result
];

function splitByAnd(prompt: string): string[] | null {
  // Only attempt if the prompt looks like two complete sentences joined by "and"
  // Pattern: <sentence ending> and <new sentence starting with capital or question word>
  const match = prompt.match(
    /^(.{15,}?)\s+and\s+((?:(?:what|how|why|when|where|who|explain|calculate|define|write|summarize|list|tell|create|generate)[^.]*|[A-Z][^.]{15,})\.?)$/i
  );

  if (!match) return null;

  const [, partA, partB] = match;
  const a = partA.trim();
  const b = partB.trim();

  // Check for dependency signals — if found, do not split
  const combined = `${a} and ${b}`;
  for (const dep of DEPENDENCY_SIGNALS) {
    if (dep.test(combined)) return null;
  }

  // Both parts should be reasonably long standalone clauses
  if (a.length < 10 || b.length < 10) return null;

  return [a, b];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Conservatively decompose a compound prompt into independent subtasks.
 *
 * Returns the original prompt as a single-item array if no confident split is found.
 */
export function decomposeQuery(prompt: string): DecomposedQuery {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { subtasks: [trimmed], wasDecomposed: false };
  }

  // Attempt splits in order of confidence
  const numbered = splitByNumberedList(trimmed);
  if (numbered) {
    return { subtasks: numbered, wasDecomposed: true };
  }

  const semicoloned = splitBySemicolon(trimmed);
  if (semicoloned) {
    return { subtasks: semicoloned, wasDecomposed: true };
  }

  const anded = splitByAnd(trimmed);
  if (anded) {
    return { subtasks: anded, wasDecomposed: true };
  }

  // No confident split found — treat as a single task
  return { subtasks: [trimmed], wasDecomposed: false };
}
