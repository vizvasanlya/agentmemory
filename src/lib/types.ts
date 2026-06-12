export const memoryKinds = [
  'note',
  'decision',
  'fact',
  'bug',
  'preference',
  'architecture',
  'task'
] as const;

export type MemoryKind = (typeof memoryKinds)[number];

export interface MemoryRecord {
  id: string;
  projectId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  score?: number;
}

export interface MemoryInput {
  id?: string;
  projectId: string;
  kind?: MemoryKind;
  title?: string;
  content: string;
  tags?: string[];
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  score?: number;
}

export interface ProjectConfig {
  projectId: string;
  name: string;
  root: string;
  memoryPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnsureProjectConfigOptions {
  memoryPath?: string;
  name?: string;
}

export interface CompressionOptions {
  maxTokens?: number;
  minLineScore?: number;
  keepFirstLines?: number;
  keepLastLines?: number;
}

export interface CompressionResult {
  originalText: string;
  compressedText: string;
  originalTokens: number;
  compressedTokens: number;
  removedTokens: number;
  compressionRatio: number;
  lineCountBefore: number;
  lineCountAfter: number;
}

export interface IndexedFile {
  path: string;
  sha256: string;
  tokens: number;
  bytes: number;
}

export interface IndexOptions {
  include?: string[];
  ignore?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface SearchOptions {
  limit?: number;
  kind?: MemoryKind;
  tags?: string[];
  minScore?: number;
}

export interface ListOptions {
  kind?: MemoryKind;
  tags?: string[];
  limit?: number;
}

export interface ScoredMemoryRecord {
  record: MemoryRecord;
  score: number;
  similarity: number;
  reasons: string[];
}

export interface DuplicateMemory {
  left: MemoryRecord;
  right: MemoryRecord;
  similarity: number;
}

export interface MemoryHealth {
  total: number;
  counts: Record<string, number>;
  duplicatePairs: number;
  expired: number;
  oldestUpdatedAt: string | null;
  newestUpdatedAt: string | null;
}

export interface MemoryCandidate {
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  reason: string;
  confidence: number;
}

export interface LearnOptions {
  maxCandidates?: number;
  minConfidence?: number;
  source?: string;
}

export interface LearnedMemoryResult {
  candidates: MemoryCandidate[];
  saved: MemoryCandidate[];
  skipped: MemoryCandidate[];
}
