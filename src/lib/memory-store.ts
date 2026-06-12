import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DuplicateMemory,
  ListOptions,
  MemoryHealth,
  MemoryInput,
  MemoryKind,
  MemoryRecord,
  ScoredMemoryRecord,
  SearchOptions
} from './types.js';

interface NormalizedSearchOptions {
  limit: number;
  kind?: MemoryKind;
  tags?: string[];
  minScore: number;
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

  async touch(id: string): Promise<MemoryRecord | undefined> {
    return this.update(id, { updatedAt: new Date().toISOString() });
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

  async list(projectId: string, options: ListOptions = {}): Promise<MemoryRecord[]> {
    const records = await this.readRecords();
    return records
      .filter((record) => record.projectId === projectId)
      .filter((record) => !options.kind || record.kind === options.kind)
      .filter((record) => matchesTags(record, options.tags))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, options.limit ?? records.length);
  }

  async search(projectId: string, query: string, options: number | SearchOptions = 10): Promise<ScoredMemoryRecord[]> {
    const searchOptions = normalizeSearchOptions(options);
    const terms = tokenize(query);
    const records = await this.list(projectId, {
      kind: searchOptions.kind,
      tags: searchOptions.tags,
      limit: searchOptions.limit * 5
    });

    if (terms.length === 0) {
      return records
        .slice(0, searchOptions.limit)
        .map((record) => ({ record, score: record.score ?? 0, similarity: 0, reasons: ['recent'] }));
    }

    const queryVector = vectorize(query);
    const results = records
      .map((record) => scoreRecord(record, queryVector, terms))
      .filter(({ score }) => score >= (searchOptions.minScore ?? 0))
      .sort((a, b) => b.score - a.score || b.similarity - a.similarity || b.record.updatedAt.localeCompare(a.record.updatedAt))
      .slice(0, searchOptions.limit);

    return results;
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

  async importRecords(projectId: string, records: MemoryRecord[], dedupe = true): Promise<number> {
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

    const nextRecords = dedupe ? mergeDeduped(existing, imported) : [...existing, ...imported];
    await this.writeRecords(nextRecords);
    return imported.length;
  }

  async findDuplicates(projectId: string, threshold = 0.88): Promise<DuplicateMemory[]> {
    const records = await this.list(projectId);
    const duplicates: DuplicateMemory[] = [];

    for (let i = 0; i < records.length; i += 1) {
      for (let j = i + 1; j < records.length; j += 1) {
        const similarity = textSimilarity(records[i].content, records[j].content);
        if (similarity >= threshold) {
          duplicates.push({ left: records[i], right: records[j], similarity });
        }
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  async health(projectId: string): Promise<MemoryHealth> {
    const records = await this.list(projectId);
    const now = new Date().toISOString();
    const counts = await this.count(projectId);
    const duplicates = await this.findDuplicates(projectId);
    const expired = records.filter((record) => record.expiresAt && record.expiresAt < now).length;
    const sortedByUpdated = [...records].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

    return {
      total: records.length,
      counts,
      duplicatePairs: duplicates.length,
      expired,
      oldestUpdatedAt: sortedByUpdated[0]?.updatedAt ?? null,
      newestUpdatedAt: sortedByUpdated[sortedByUpdated.length - 1]?.updatedAt ?? null
    };
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

function normalizeSearchOptions(options: number | SearchOptions): NormalizedSearchOptions {
  if (typeof options === 'number') {
    return { limit: options, minScore: 0 };
  }

  return {
    limit: options.limit ?? 10,
    kind: options.kind,
    tags: options.tags,
    minScore: options.minScore ?? 0
  };
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[\s,;|:()[\]{}]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function vectorize(value: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const term of tokenize(value)) {
    vector.set(term, (vector.get(term) ?? 0) + 1);
  }

  return vector;
}

function scoreRecord(record: MemoryRecord, queryVector: Map<string, number>, terms: string[]): ScoredMemoryRecord {
  const recordVector = vectorize(`${record.title} ${record.tags.join(' ')} ${record.content}`);
  const titleVector = vectorize(record.title);
  const tagVector = vectorize(record.tags.join(' '));
  const contentVector = vectorize(record.content);
  const similarity = cosineSimilarity(queryVector, recordVector);
  const titleSimilarity = cosineSimilarity(queryVector, titleVector);
  const tagSimilarity = cosineSimilarity(queryVector, tagVector);
  const contentSimilarity = cosineSimilarity(queryVector, contentVector);
  const recencyScore = recency(record.updatedAt);
  const reasons: string[] = [];

  let score = 0;
  score += titleSimilarity * 45;
  score += tagSimilarity * 18;
  score += contentSimilarity * 22;
  score += similarity * 10;
  score += recencyScore * 5;
  score += record.score ?? 0;

  if (titleSimilarity > 0.15) {
    reasons.push('title');
  }

  if (tagSimilarity > 0.15) {
    reasons.push('tag');
  }

  if (contentSimilarity > 0.15) {
    reasons.push('content');
  }

  if (terms.some((term) => record.content.toLowerCase().includes(term))) {
    reasons.push('exact-term');
  }

  if (recencyScore > 0.5) {
    reasons.push('recent');
  }

  return {
    record,
    score: Number(score.toFixed(3)),
    similarity: Number(similarity.toFixed(3)),
    reasons
  };
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (const [term, value] of a) {
    magnitudeA += value * value;
    dot += value * (b.get(term) ?? 0);
  }

  for (const value of b.values()) {
    magnitudeB += value * value;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

function textSimilarity(a: string, b: string): number {
  return cosineSimilarity(vectorize(a), vectorize(b));
}

function recency(updatedAt: string): number {
  const ageInDays = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  if (ageInDays <= 1) {
    return 1;
  }

  if (ageInDays <= 7) {
    return 0.75;
  }

  if (ageInDays <= 30) {
    return 0.5;
  }

  if (ageInDays <= 90) {
    return 0.25;
  }

  return 0.1;
}

function matchesTags(record: MemoryRecord, tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }

  const recordTags = new Set(record.tags.map((tag) => tag.toLowerCase()));
  return tags.some((tag) => recordTags.has(tag.toLowerCase()));
}

function mergeDeduped(existing: MemoryRecord[], imported: MemoryRecord[]): MemoryRecord[] {
  const byKey = new Map<string, MemoryRecord>();
  for (const record of [...existing, ...imported]) {
    const key = `${record.kind}:${record.title.toLowerCase()}:${record.content.slice(0, 160).toLowerCase()}`;
    const current = byKey.get(key);
    if (!current || record.updatedAt > current.updatedAt) {
      byKey.set(key, record);
    }
  }

  return [...byKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
