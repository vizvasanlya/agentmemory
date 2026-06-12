import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MemoryInput, MemoryKind, MemoryRecord } from './types.js';

interface ScoredRecord {
  record: MemoryRecord;
  score: number;
}

export class MemoryStore {
  constructor(private readonly memoryPath: string) {}

  async save(input: MemoryInput): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const existing = input.id ? await this.get(input.id) : undefined;
    const record: MemoryRecord = {
      id: input.id ?? randomUUID(),
      projectId: input.projectId,
      kind: input.kind ?? 'note',
      title: normalizeTitle(input.title, input.content),
      content: input.content.trim(),
      tags: normalizeTags(input.tags),
      source: input.source,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      expiresAt: input.expiresAt,
      score: input.score ?? existing?.score ?? 0
    };

    const records = await this.readRecords();
    const nextRecords = existing
      ? records.map((candidate) => (candidate.id === record.id ? record : candidate))
      : [...records, record];

    await this.writeRecords(nextRecords);
    return record;
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const records = await this.readRecords();
    return records.find((record) => record.id === id);
  }

  async update(id: string, patch: Partial<MemoryInput>): Promise<MemoryRecord | undefined> {
    const existing = await this.get(id);
    if (!existing) {
      return undefined;
    }

    return this.save({
      ...existing,
      ...patch,
      id,
      projectId: existing.projectId,
      content: patch.content ?? existing.content,
      kind: (patch.kind as MemoryKind | undefined) ?? existing.kind,
      tags: patch.tags ?? existing.tags,
      source: patch.source ?? existing.source,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt
    });
  }

  async delete(id: string): Promise<boolean> {
    const records = await this.readRecords();
    const nextRecords = records.filter((record) => record.id !== id);
    if (nextRecords.length === records.length) {
      return false;
    }

    await this.writeRecords(nextRecords);
    return true;
  }

  async list(projectId: string): Promise<MemoryRecord[]> {
    const records = await this.readRecords();
    return records
      .filter((record) => record.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async search(projectId: string, query: string, limit = 10): Promise<ScoredRecord[]> {
    const terms = tokenize(query);
    const records = await this.list(projectId);

    if (terms.length === 0) {
      return records.slice(0, limit).map((record) => ({ record, score: record.score ?? 0 }));
    }

    return records
      .map((record) => ({ record, score: scoreRecord(record, terms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, limit);
  }

  async count(projectId: string): Promise<Record<string, number>> {
    const records = await this.list(projectId);
    return records.reduce<Record<string, number>>((counts, record) => {
      counts[record.kind] = (counts[record.kind] ?? 0) + 1;
      return counts;
    }, {});
  }

  async clear(projectId: string): Promise<number> {
    const records = await this.readRecords();
    const nextRecords = records.filter((record) => record.projectId !== projectId);
    await this.writeRecords(nextRecords);
    return records.length - nextRecords.length;
  }

  async export(projectId: string): Promise<MemoryRecord[]> {
    return this.list(projectId);
  }

  async importRecords(projectId: string, records: MemoryRecord[]): Promise<number> {
    const existing = await this.readRecords();
    const now = new Date().toISOString();
    const imported = records.map((record) => ({
      ...record,
      id: record.id || randomUUID(),
      projectId,
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || now,
      tags: normalizeTags(record.tags)
    }));

    await this.writeRecords([...existing, ...imported]);
    return imported.length;
  }

  private async readRecords(): Promise<MemoryRecord[]> {
    try {
      const content = await readFile(this.memoryPath, 'utf8');
      return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as MemoryRecord)
        .filter(isMemoryRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async writeRecords(records: MemoryRecord[]): Promise<void> {
    await mkdir(path.dirname(this.memoryPath), { recursive: true });
    const tempPath = `${this.memoryPath}.${randomUUID()}.tmp`;
    const content = records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');

    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, this.memoryPath);
  }
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<MemoryRecord>;
  return typeof record.id === 'string'
    && typeof record.projectId === 'string'
    && typeof record.kind === 'string'
    && typeof record.title === 'string'
    && typeof record.content === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string';
}

function normalizeTitle(title: string | undefined, content: string): string {
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed;
  }

  const firstLine = content.split(/\r?\n/).find((line) => line.trim()) ?? 'Untitled memory';
  return firstLine.slice(0, 120);
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,;|]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function scoreRecord(record: MemoryRecord, terms: string[]): number {
  const title = record.title.toLowerCase();
  const content = record.content.toLowerCase();
  const tags = record.tags.map((tag) => tag.toLowerCase()).join(' ');

  return terms.reduce((score, term) => {
    if (title.includes(term)) {
      return score + 8;
    }

    if (tags.includes(term)) {
      return score + 5;
    }

    if (content.includes(term)) {
      return score + 2;
    }

    return score;
  }, record.score ?? 0);
}
