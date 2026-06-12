import { describe, expect, it } from 'vitest';
import { suggestMemories } from '../src/lib/learning.js';

describe('suggestMemories', () => {
  it('extracts labeled project decisions and bugs', () => {
    const input = `
Decision: Use PostgreSQL for durable local memory.
Bug: Payment retries must only run for idempotent operations.
Architecture: The MCP server reads memories from a local JSONL file.
`;

    const candidates = suggestMemories(input, { source: 'notes' });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.some((candidate) => candidate.kind === 'decision')).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'bug')).toBe(true);
    expect(candidates.every((candidate) => candidate.tags.includes('source:notes'))).toBe(true);
  });
});
