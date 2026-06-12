#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { compressContext, formatCompressionSummary } from './lib/compression.js';
import { ensureProjectConfig, readProjectConfig, resolveProjectRoot, splitTags } from './lib/paths.js';
import { MemoryStore } from './lib/memory-store.js';
import { createProjectMap, indexProject } from './lib/repo-indexer.js';
import { runMcpServer } from './lib/mcp-server.js';
import { memoryKinds, type MemoryKind } from './lib/types.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('agentmemory')
  .description('Local-first memory and context compression for AI coding agents')
  .version(VERSION);

program
  .command('init')
  .description('Initialize AgentMemory for the current project')
  .argument('[root]', 'project root')
  .option('--memory <path>', 'memory file path')
  .option('--name <name>', 'project name')
  .action(async (root, options) => {
    try {
      const spinner = ora('Initializing AgentMemory').start();
      const projectRoot = resolveProjectRoot(root);
      const config = await ensureProjectConfig(projectRoot, { memoryPath: options.memory, name: options.name });
      spinner.succeed(`Initialized AgentMemory for ${config.name}`);
      console.log(`Project ID: ${config.projectId}`);
      console.log(`Memory file: ${config.memoryPath}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('remember')
  .description('Save a durable project memory')
  .argument('<content>', 'memory content')
  .option('-k, --kind <kind>', `memory kind: ${memoryKinds.join(', ')}`, 'note')
  .option('-t, --title <title>', 'memory title')
  .option('--tag <tags>', 'comma-separated tags; repeat for multiple tags', (value: string, previous: string[] = []) => [...previous, value])
  .option('--source <source>', 'source reference')
  .option('--json', 'print JSON output')
  .action(async (content, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const record = await store.save({
        projectId: config.projectId,
        kind: parseKind(options.kind),
        title: options.title,
        content,
        tags: splitTags(options.tag),
        source: options.source
      });

      if (options.json) {
        console.log(JSON.stringify(record, null, 2));
        return;
      }

      console.log(`Saved memory ${record.id}`);
      console.log(`Kind: ${record.kind}`);
      console.log(`Title: ${record.title}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('recall')
  .description('Search local project memories')
  .argument('<query>', 'search query')
  .option('-k, --kind <kind>', `filter by kind: ${memoryKinds.join(', ')}`)
  .option('-l, --limit <limit>', 'maximum results', '10')
  .option('--json', 'print JSON output')
  .action(async (query, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const results = await store.search(config.projectId, query, Number(options.limit));
      const filtered = options.kind
        ? results.filter(({ record }) => record.kind === parseKind(options.kind))
        : results;

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      if (filtered.length === 0) {
        console.log('No memories found.');
        return;
      }

      for (const { record, score } of filtered) {
        console.log(`\n${chalk.bold(record.title)} [${record.kind}] score=${score.toFixed(1)}`);
        console.log(record.content);
        if (record.tags.length > 0) {
          console.log(`Tags: ${record.tags.join(', ')}`);
        }
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command('compress')
  .description('Compress a file or stdin into a smaller AI context')
  .argument('[file]', 'file to compress; omit to read stdin')
  .option('-o, --out <path>', 'write compressed output to a file')
  .option('--max-tokens <tokens>', 'maximum output tokens', '2000')
  .option('--json', 'print JSON output')
  .action(async (file, options) => {
    try {
      const text = file ? await readFile(file, 'utf8') : await readStdin();
      const result = compressContext(text, { maxTokens: Number(options.maxTokens) });

      if (options.json) {
        console.log(JSON.stringify({
          originalTokens: result.originalTokens,
          compressedTokens: result.compressedTokens,
          removedTokens: result.removedTokens,
          compressionRatio: result.compressionRatio,
          compressedText: result.compressedText
        }, null, 2));
        return;
      }

      if (options.out) {
        await writeFile(options.out, result.compressedText, 'utf8');
        console.log(`Wrote compressed context to ${options.out}`);
      } else {
        console.log(formatCompressionSummary(result));
        console.log('\n--- compressed context ---');
        console.log(result.compressedText);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command('index')
  .description('Index the project structure and optionally save it as memory')
  .argument('[root]', 'project root')
  .option('--no-save', 'do not save the index as memory')
  .option('--max-files <count>', 'maximum files to index', '1000')
  .option('--max-file-bytes <bytes>', 'maximum file size to index', String(1024 * 1024))
  .option('--json', 'print JSON output')
  .action(async (root, options) => {
    try {
      const projectRoot = resolveProjectRoot(root);
      const config = await ensureProjectConfig(projectRoot);
      const files = await indexProject(projectRoot, {
        maxFiles: Number(options.maxFiles),
        maxFileBytes: Number(options.maxFileBytes)
      });
      const map = createProjectMap(files, config.name);

      if (options.save !== false) {
        const store = new MemoryStore(config.memoryPath);
        await store.save({
          projectId: config.projectId,
          kind: 'architecture',
          title: 'Project index',
          content: map,
          tags: ['index', 'architecture']
        });
      }

      if (options.json) {
        console.log(JSON.stringify({ files, projectMap: map }, null, 2));
        return;
      }

      console.log(`Indexed ${files.length} files`);
      console.log(`Estimated tokens: ${files.reduce((sum, file) => sum + file.tokens, 0)}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('status')
  .description('Show local memory status')
  .option('--json', 'print JSON output')
  .action(async (options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const counts = await store.count(config.projectId);
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

      if (options.json) {
        console.log(JSON.stringify({ project: config, counts, total }, null, 2));
        return;
      }

      console.log(`Project: ${config.name}`);
      console.log(`Memory file: ${config.memoryPath}`);
      console.log(`Total memories: ${total}`);
      for (const [kind, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`${kind}: ${count}`);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command('export')
  .description('Export project memories as JSON')
  .action(async () => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      console.log(JSON.stringify(await store.export(config.projectId), null, 2));
    } catch (error) {
      fail(error);
    }
  });

program
  .command('mcp')
  .description('Start the AgentMemory MCP server over stdio')
  .argument('[root]', 'project root')
  .option('--memory <path>', 'memory file path')
  .action((root, options) => {
    runMcpServer({ projectRoot: root, memoryPath: options.memory }).catch(fail);
  });

program.parseAsync(process.argv);

async function currentConfig() {
  const projectRoot = resolveProjectRoot();
  const config = await readProjectConfig(projectRoot) ?? await ensureProjectConfig(projectRoot);
  return config;
}

function parseKind(value: unknown): MemoryKind {
  return memoryKinds.includes(value as MemoryKind) ? value as MemoryKind : 'note';
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(message));
  process.exitCode = 1;
}
