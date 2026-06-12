import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/lib/memory-store.js';

describe('MemoryStore', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('saves, searches, and counts memories', async () => {
    const memoryPath = path.join(await mkdtemp(path.join(tmpdir(), 'agentmemory-')), 'memory.jsonl');
    tempDirs.push(path.dirname(memoryPath));
    const store = new MemoryStore(memoryPath);
    const projectId = 'project-1';

    await store.save({
      projectId,
      kind: 'decision',
      title: 'Use local JSONL memory',
      content: 'Store memories in a local JSONL file so the CLI works without native dependencies.',
      tags: ['memory', 'local']
    });

    await store.save({
      projectId,
      kind: 'bug',
      title: 'Payment retry bug',
      content: 'Retry only idempotent payment operations and never retry non-idempotent charges.',
      tags: ['payments', 'bug']
    });

    const results = await store.search(projectId, 'payment retry');
    expect(results[0].record.title).toBe('Payment retry bug');

    const counts = await store.count(projectId);
    expect(counts.decision).toBe(1);
    expect(counts.bug).toBe(1);
  });
});
