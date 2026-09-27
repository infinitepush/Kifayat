/**
 * Kifayat Engine — Reassembler
 *
 * Stitches the answers from multiple subtasks back into a single coherent response.
 *
 * Strategy:
 * - If only one subtask (wasDecomposed=false): return the answer directly.
 * - If multiple subtasks: format them cleanly with lightweight structure
 *   (numbered sections matching the original split).
 */

import type { SubtaskResult } from "./types";

/**
 * Reassemble multiple subtask answers into a single cohesive response.
 */
export function reassemble(subtaskResults: SubtaskResult[]): string {
  if (subtaskResults.length === 0) {
    return "No results to return.";
  }

  if (subtaskResults.length === 1) {
    // Single task — return directly, no wrapper
    return subtaskResults[0].tierResult.answer;
  }

  // Multiple subtasks — format with numbered sections
  const sections = subtaskResults.map((r, i) => {
    const taskLabel = `**${i + 1}. ${r.subtask.slice(0, 80)}${r.subtask.length > 80 ? "..." : ""}**`;
    return `${taskLabel}\n\n${r.tierResult.answer}`;
  });

  return sections.join("\n\n---\n\n");
}
