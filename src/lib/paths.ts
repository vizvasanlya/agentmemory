import { randomUUID } from 'node:crypto';
import { constants, access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { EnsureProjectConfigOptions, ProjectConfig } from './types.js';

export const PROJECT_CONFIG_DIR = '.agentmemory';
export const DEFAULT_MEMORY_FILE = 'memory.jsonl';

export function resolveProjectRoot(input?: string): string {
  const start = path.resolve(input ?? process.cwd());
  let current = start;

  while (true) {
    if (existsSync(path.join(current, 'package.json')) || existsSync(path.join(current, '.git'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }

    current = parent;
  }
}

export async function ensureProjectConfig(
  projectRoot: string,
  options: EnsureProjectConfigOptions = {}
): Promise<ProjectConfig> {
  const root = path.resolve(projectRoot);
  const configDir = path.join(root, PROJECT_CONFIG_DIR);
  const configPath = path.join(configDir, 'config.json');
  const defaultMemoryPath = path.join(configDir, DEFAULT_MEMORY_FILE);

  await mkdir(configDir, { recursive: true });

  const now = new Date().toISOString();
  const existing = await readOptionalJson<ProjectConfig>(configPath);
  const requestedMemoryPath = options.memoryPath ?? existing?.memoryPath ?? defaultMemoryPath;
  const memoryPath = path.isAbsolute(requestedMemoryPath)
    ? requestedMemoryPath
    : path.resolve(root, requestedMemoryPath);

  const config: ProjectConfig = {
    projectId: existing?.projectId ?? randomUUID(),
    name: options.name ?? existing?.name ?? (path.basename(root) || 'agentmemory-project'),
    root,
    memoryPath,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeJsonFileAtomic(configPath, config);
  return config;
}

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig | undefined> {
  const configPath = path.join(path.resolve(projectRoot), PROJECT_CONFIG_DIR, 'config.json');
  return readOptionalJson<ProjectConfig>(configPath);
}

export async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    return undefined;
  }

  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `${path.basename(filePath)}.${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

export function splitTags(value?: string | string[]): string[] {
  const raw = Array.isArray(value) ? value : value?.split(',');
  return [...new Set((raw ?? []).flatMap((tag) => tag.split(',')).map((tag) => tag.trim()).filter(Boolean))];
}
