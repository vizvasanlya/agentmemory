export { MemoryStore } from './lib/memory-store.js';
export { compressContext, formatCompressionSummary } from './lib/compression.js';
export { indexProject, createProjectMap } from './lib/repo-indexer.js';
export { ensureProjectConfig, readProjectConfig, resolveProjectRoot, splitTags } from './lib/paths.js';
export type {
  CompressionOptions,
  CompressionResult,
  IndexedFile,
  IndexOptions,
  MemoryInput,
  MemoryKind,
  MemoryRecord,
  ProjectConfig
} from './lib/types.js';
