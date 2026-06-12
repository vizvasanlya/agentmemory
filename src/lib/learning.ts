import type { LearnedMemoryResult, LearnOptions, MemoryCandidate, MemoryKind, MemoryRecord } from './types.js';

export function suggestMemories(text: string, options: LearnOptions = {}): MemoryCandidate[] {
  const maxCandidates = options.maxCandidates ?? 8;
  const minConfidence = options.minConfidence ?? 0.45;
  const candidates = [
    ...extractLabeledMemories(text, options.source),
    ...extractStructuredMemories(text, options.source)
  ];

  return [...candidates]
    .sort((a, b) => b.confidence - a.confidence)
    .filter((candidate) => candidate.confidence >= minConfidence)
    .slice(0, maxCandidates);
}

export async function learnText(
  text: string,
  saveMemory: (candidate: MemoryCandidate) => Promise<MemoryRecord>,
  options: LearnOptions = {}
): Promise<LearnedMemoryResult> {
  const candidates = suggestMemories(text, options);
  const saved: MemoryCandidate[] = [];
  const skipped: MemoryCandidate[] = [];

  for (const candidate of candidates) {
    try {
      await saveMemory(candidate);
      saved.push(candidate);
    } catch {
      skipped.push(candidate);
    }
  }

  return { candidates, saved, skipped };
}

function extractLabeledMemories(text: string, source?: string): MemoryCandidate[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const candidates: MemoryCandidate[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(decision|architecture|bug|preference|fact|note|todo|fixme)\s*[:-]\s*(.+)$/i);
    if (!match) {
      continue;
    }

    const label = match[1].toLowerCase();
    const content = match[2].trim();
    if (content.length < 8) {
      continue;
    }

    const kind = labelToKind(label);
    const title = titleFromContent(kind, content);
    candidates.push({
      kind,
      title,
      content,
      tags: source ? [sourceTag(source), kind] : [kind],
      reason: `Detected ${label} statement`,
      confidence: label === 'decision' || label === 'architecture' || label === 'bug' ? 0.92 : 0.72
    });
  }

  return candidates;
}

function extractStructuredMemories(text: string, source?: string): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const sections = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  for (const section of sections.slice(0, 12)) {
    const heading = section.split(/\r?\n/)[0] ?? '';
    const body = section.split(/\r?\n/).slice(1).join('\n').trim() || heading;
    const kind = inferKind(section);
    const title = titleFromContent(kind, heading || body);
    const confidence = inferConfidence(section, kind);

    if (confidence < 0.5 || body.length < 12) {
      continue;
    }

    candidates.push({
      kind,
      title,
      content: body.length > 900 ? body.slice(0, 900) : body,
      tags: source ? [sourceTag(source), kind, 'learned'] : [kind, 'learned'],
      reason: 'Inferred from structured project text',
      confidence
    });
  }

  return candidates;
}

function labelToKind(label: string): MemoryKind {
  if (label === 'decision') {
    return 'decision';
  }

  if (label === 'architecture') {
    return 'architecture';
  }

  if (label === 'bug' || label === 'fixme') {
    return 'bug';
  }

  if (label === 'preference') {
    return 'preference';
  }

  if (label === 'fact') {
    return 'fact';
  }

  if (label === 'todo') {
    return 'task';
  }

  return 'note';
}

function inferKind(section: string): MemoryKind {
  if (/(decision|decided|choose|use [a-z0-9_.-]+ for|avoid)/i.test(section)) {
    return 'decision';
  }

  if (/(architecture|design|system|module|component|service|api|database|schema)/i.test(section)) {
    return 'architecture';
  }

  if (/(bug|fix|error|fail|exception|regression|broken)/i.test(section)) {
    return 'bug';
  }

  if (/(preference|prefer|always|never|rule|policy|convention)/i.test(section)) {
    return 'preference';
  }

  if (/(todo|task|next|implement|ship|release)/i.test(section)) {
    return 'task';
  }

  return 'note';
}

function inferConfidence(section: string, kind: MemoryKind): number {
  const lower = section.toLowerCase();
  let score = 0.38;

  if (kind === 'decision' || kind === 'architecture' || kind === 'bug') {
    score += 0.25;
  }

  if (/(must|should|always|never|because|therefore|so that)/i.test(lower)) {
    score += 0.12;
  }

  if (lower.length > 80) {
    score += 0.1;
  }

  if (/(memory|agent|context|prompt|cli|mcp|token|project)/i.test(lower)) {
    score += 0.08;
  }

  return Math.min(0.96, score);
}

function titleFromContent(kind: MemoryKind, content: string): string {
  const cleaned = content
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:]+$/, '')
    .trim();

  const prefix = kind === 'bug' ? 'Bug: ' : kind === 'decision' ? 'Decision: ' : kind === 'architecture' ? 'Architecture: ' : '';
  return `${prefix}${cleaned.slice(0, 90)}`;
}

function sourceTag(source: string | undefined): string {
  return source ? `source:${source}` : 'source:learn';
}
