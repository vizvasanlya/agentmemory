import type { CompressionOptions, CompressionResult } from './types.js';
import { estimateTokens } from './tokens.js';

const IMPORTANT_LINE_REGEX = /(error|fail|failed|failure|exception|panic|fatal|assert|warn|warning|timeout|denied|unauthorized|not found|stack|trace|todo|fixme|bug|migration|schema|api|route|handler|controller|service|repository|component|function|class|interface|type|select|insert|update|delete|test|describe|it\(|expect\()/i;

export function compressContext(text: string, options: CompressionOptions = {}): CompressionResult {
  const maxTokens = options.maxTokens ?? 2000;
  const minLineScore = options.minLineScore ?? 1;
  const keepFirstLines = options.keepFirstLines ?? 20;
  const keepLastLines = options.keepLastLines ?? 20;
  const normalized = text.replace(/\r\n/g, '\n');
  const originalTokens = estimateTokens(normalized);

  if (originalTokens <= maxTokens) {
    return createCompressionResult(normalized, normalized);
  }

  const lines = normalized.split('\n');
  const collapsed = collapseRepeatedLines(lines);
  const scored = collapsed.map((line, index) => ({
    line,
    index,
    score: scoreLine(line, index, collapsed.length)
  }));

  const selected = new Set<number>();
  const budget = Math.max(120, maxTokens - 80);
  const importantBudget = Math.floor(budget * 0.55);
  let importantTokens = 0;

  scored
    .filter(({ score }) => score >= Math.max(minLineScore, 20))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .forEach((candidate) => {
      const nextTokens = importantTokens + estimateTokens(candidate.line);
      if (nextTokens <= importantBudget) {
        selected.add(candidate.index);
        importantTokens = nextTokens;
      }
    });

  const edgeCandidates = scored
    .filter(({ index }) => !selected.has(index))
    .filter(({ index }) => index < keepFirstLines || index >= collapsed.length - keepLastLines)
    .sort((a, b) => a.index - b.index);

  let currentTokens = importantTokens;
  for (const candidate of edgeCandidates) {
    const nextTokens = currentTokens + estimateTokens(candidate.line);
    if (nextTokens > budget && selected.size > selectedImportantMinimum(collapsed.length)) {
      break;
    }

    selected.add(candidate.index);
    currentTokens = nextTokens;
  }

  const candidates = scored
    .filter(({ index }) => !selected.has(index))
    .filter(({ score }) => score >= minLineScore)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const candidate of candidates) {
    const nextTokens = currentTokens + estimateTokens(candidate.line);
    if (nextTokens > budget && selected.size > selectedImportantMinimum(collapsed.length)) {
      break;
    }

    selected.add(candidate.index);
    currentTokens = nextTokens;
  }

  let compressedText = buildCompressedText(collapsed, selected);
  if (estimateTokens(compressedText) > maxTokens) {
    compressedText = compressByBudget(collapsed, maxTokens);
  }

  return createCompressionResult(normalized, compressedText);
}

export function formatCompressionSummary(result: CompressionResult): string {
  const ratio = Math.round(result.compressionRatio * 100);
  return [
    `Original tokens: ${result.originalTokens}`,
    `Compressed tokens: ${result.compressedTokens}`,
    `Removed tokens: ${result.removedTokens}`,
    `Compression: ${ratio}%`,
    `Lines: ${result.lineCountBefore} -> ${result.lineCountAfter}`
  ].join('\n');
}

function createCompressionResult(originalText: string, compressedText: string): CompressionResult {
  const originalTokens = estimateTokens(originalText);
  const compressedTokens = estimateTokens(compressedText);
  const removedTokens = Math.max(0, originalTokens - compressedTokens);
  const compressionRatio = originalTokens > 0 ? removedTokens / originalTokens : 0;

  return {
    originalText,
    compressedText,
    originalTokens,
    compressedTokens,
    removedTokens,
    compressionRatio,
    lineCountBefore: originalText.split('\n').length,
    lineCountAfter: compressedText.split('\n').length
  };
}

function collapseRepeatedLines(lines: string[]): string[] {
  const collapsed: string[] = [];
  let repeatedCount = 0;
  let previous = '';

  for (const line of lines) {
    if (line === previous && repeatedCount < 3) {
      repeatedCount += 1;
      continue;
    }

    if (line === previous) {
      collapsed.push(`[agentmemory: repeated line omitted ${repeatedCount - 2} times]`);
      repeatedCount = 1;
      continue;
    }

    collapsed.push(line);
    previous = line;
    repeatedCount = 0;
  }

  return collapsed;
}

function scoreLine(line: string, index: number, totalLines: number): number {
  if (!line.trim()) {
    return -5;
  }

  let score = 1;
  if (IMPORTANT_LINE_REGEX.test(line)) {
    score += 30;
  }

  if (/^\s*(#|\/\/|\/\*|\*|<!--)/.test(line)) {
    score -= 2;
  }

  if (line.length > 160) {
    score += 6;
  }

  if (index < 10 || index > totalLines - 10) {
    score += 3;
  }

  return score;
}

function buildCompressedText(lines: string[], selected: Set<number>): string {
  const output: string[] = [];
  let skipped = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!selected.has(index)) {
      skipped += 1;
      continue;
    }

    if (skipped > 0) {
      output.push(`[agentmemory: omitted ${skipped} low-value lines]`);
      skipped = 0;
    }

    output.push(lines[index]);
  }

  if (skipped > 0) {
    output.push(`[agentmemory: omitted ${skipped} low-value lines]`);
  }

  return output.join('\n');
}

function compressByBudget(lines: string[], maxTokens: number): string {
  const output: string[] = [];
  let tokens = 0;
  let skipped = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens + 12 <= maxTokens) {
      if (skipped > 0) {
        output.push(`[agentmemory: omitted ${skipped} lines to stay within token budget]`);
        skipped = 0;
      }

      output.push(line);
      tokens += lineTokens;
    } else {
      skipped += 1;
    }
  }

  if (skipped > 0) {
    output.push(`[agentmemory: omitted ${skipped} lines to stay within token budget]`);
  }

  return output.join('\n');
}

function selectedImportantMinimum(totalLines: number): number {
  return Math.min(40, Math.max(10, Math.floor(totalLines * 0.1)));
}
