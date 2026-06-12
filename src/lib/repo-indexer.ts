import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type { IndexedFile, IndexOptions } from './types.js';
import { estimateTokens } from './tokens.js';

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.turbo/**',
  '**/.agentmemory/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb'
];

export async function indexProject(projectRoot: string, options: IndexOptions = {}): Promise<IndexedFile[]> {
  const root = path.resolve(projectRoot);
  const patterns = options.include?.length ? options.include : ['**/*'];
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];
  const maxFiles = options.maxFiles ?? 1000;
  const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;

  const files = await fg(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore
  });

  const indexed: IndexedFile[] = [];
  for (const file of files.slice(0, maxFiles)) {
    const stats = await stat(file);
    if (stats.size > maxFileBytes) {
      continue;
    }

    const content = await readFile(file, 'utf8');
    indexed.push({
      path: path.relative(root, file).split(path.sep).join('/'),
      sha256: createHash('sha256').update(content).digest('hex'),
      tokens: estimateTokens(content),
      bytes: stats.size
    });
  }

  return indexed.sort((a, b) => a.path.localeCompare(b.path));
}

export function createProjectMap(files: IndexedFile[], projectName: string): string {
  const totalTokens = files.reduce((sum, file) => sum + file.tokens, 0);
  const byExtension = files.reduce<Record<string, number>>((counts, file) => {
    const extension = path.extname(file.path) || 'no-extension';
    counts[extension] = (counts[extension] ?? 0) + 1;
    return counts;
  }, {});

  const topFiles = [...files]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 40)
    .map((file) => `- ${file.path} (${file.tokens} tokens, ${file.bytes} bytes)`)
    .join('\n');

  const extensions = Object.entries(byExtension)
    .sort((a, b) => b[1] - a[1])
    .map(([extension, count]) => `- ${extension}: ${count}`)
    .join('\n');

  return [
    `Project: ${projectName}`,
    `Indexed files: ${files.length}`,
    `Estimated tokens: ${totalTokens}`,
    '',
    'Extensions:',
    extensions || '- none',
    '',
    'Largest files:',
    topFiles || '- none'
  ].join('\n');
}
