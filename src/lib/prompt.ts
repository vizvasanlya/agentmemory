import type { ScoredMemoryRecord } from './types.js';

export interface PromptOptions {
  maxTokens?: number;
  limit?: number;
  projectName?: string;
}

export interface PromptSnippet {
  text: string;
  tokens: number;
  memoriesUsed: number;
}

export function buildPromptSnippet(results: ScoredMemoryRecord[], options: PromptOptions = {}): PromptSnippet {
  const limit = options.limit ?? 8;
  const maxTokens = options.maxTokens ?? 1800;
  const selected = results.slice(0, limit);
  const lines: string[] = [];

  lines.push('# AgentMemory project context');
  if (options.projectName) {
    lines.push(`Project: ${options.projectName}`);
  }

  lines.push('Use the following durable project memories before answering. Prefer recent, specific memories over generic ones.');
  lines.push('');

  for (const { record, score, similarity, reasons } of selected) {
    lines.push(`## ${record.title}`);
    lines.push(`Kind: ${record.kind}`);
    lines.push(`Score: ${score} | Similarity: ${similarity} | Reasons: ${reasons.join(', ') || 'recency'}`);
    if (record.tags.length > 0) {
      lines.push(`Tags: ${record.tags.join(', ')}`);
    }

    lines.push(record.content);
    lines.push('');
  }

  let text = lines.join('\n').trim();
  while (estimateTokens(text) > maxTokens && selected.length > 0) {
    selected.pop();
    text = rebuildPrompt(selected, options);
  }

  return {
    text,
    tokens: estimateTokens(text),
    memoriesUsed: selected.length
  };
}

function rebuildPrompt(selected: ScoredMemoryRecord[], options: PromptOptions): string {
  const lines: string[] = [];
  lines.push('# AgentMemory project context');
  if (options.projectName) {
    lines.push(`Project: ${options.projectName}`);
  }

  lines.push('Use the following durable project memories before answering.');
  lines.push('');

  for (const { record, score, similarity, reasons } of selected) {
    lines.push(`## ${record.title}`);
    lines.push(`Kind: ${record.kind}`);
    lines.push(`Score: ${score} | Similarity: ${similarity} | Reasons: ${reasons.join(', ') || 'recency'}`);
    lines.push(record.content);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function estimateTokens(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  const words = text.match(/[\p{L}\p{N}_]+|[{}()[\].,:;+=\-/*<>|&]/gu) ?? [];
  return Math.max(1, Math.ceil(words.length * 0.75));
}
