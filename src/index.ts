export { MemoryStore } from './lib/memory-store.js';
export { compressContext, formatCompressionSummary } from './lib/compression.js';
export { indexProject, createProjectMap } from './lib/repo-indexer.js';
export { suggestMemories, learnText } from './lib/learning.js';
export { buildPromptSnippet } from './lib/prompt.js';
export { buildDoctorReport } from './lib/doctor.js';
export { ensureProjectConfig, readProjectConfig, resolveProjectRoot, splitTags } from './lib/paths.js';
export type {
  CompressionOptions,
  CompressionResult,
  DuplicateMemory,
  IndexedFile,
  IndexOptions,
  LearnOptions,
  LearnedMemoryResult,
  ListOptions,
  MemoryCandidate,
  MemoryHealth,
  MemoryInput,
  MemoryKind,
  MemoryRecord,
  ProjectConfig,
  ScoredMemoryRecord,
  SearchOptions
} from './lib/types.js';
