#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { compressContext, formatCompressionSummary } from './lib/compression.js';
import { buildDoctorReport } from './lib/doctor.js';
import { learnText, suggestMemories } from './lib/learning.js';
import { MemoryStore } from './lib/memory-store.js';
import { buildPromptSnippet } from './lib/prompt.js';
import { ensureProjectConfig, readProjectConfig, resolveProjectRoot, splitTags } from './lib/paths.js';
import { createProjectMap, indexProject } from './lib/repo-indexer.js';
import { runMcpServer } from './lib/mcp-server.js';
import { memoryKinds, type MemoryCandidate, type MemoryKind, type MemoryRecord } from './lib/types.js';

const VERSION = '0.2.0';

const program = new Command();

program
  .name('agentmemory')
  .description('Local-first memory, learning, prompt context, and compression for AI coding agents')
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
      const record = await saveMemory(config, {
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

      printSaved(record);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('learn')
  .description('Extract memory candidates from text, a file, or stdin')
  .argument('[file]', 'file to learn from; omit to read stdin')
  .option('--dry-run', 'show candidates without saving')
  .option('--max-candidates <count>', 'maximum candidates to save', '8')
  .option('--min-confidence <score>', 'minimum confidence threshold', '0.45')
  .option('--source <source>', 'source tag')
  .option('--json', 'print JSON output')
  .action(async (file, options) => {
    try {
      const config = await currentConfig();
      const text = file ? await readFile(file, 'utf8') : await readStdin();
      const result = await learnText(text, async (candidate) => saveMemory(config, candidate), {
        maxCandidates: Number(options.maxCandidates),
        minConfidence: Number(options.minConfidence),
        source: options.source
      });

      if (options.dryRun) {
        printCandidates(result.candidates);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Detected ${result.candidates.length} memory candidates`);
      console.log(`Saved ${result.saved.length}`);
      if (result.skipped.length > 0) {
        console.log(`Skipped ${result.skipped.length}`);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command('suggest')
  .description('Preview memory candidates from text, a file, or stdin')
  .argument('[file]', 'file to inspect; omit to read stdin')
  .option('--max-candidates <count>', 'maximum candidates', '8')
  .option('--min-confidence <score>', 'minimum confidence threshold', '0.45')
  .option('--source <source>', 'source tag')
  .option('--json', 'print JSON output')
  .action(async (file, options) => {
    try {
      const text = file ? await readFile(file, 'utf8') : await readStdin();
      const candidates = suggestMemories(text, {
        maxCandidates: Number(options.maxCandidates),
        minConfidence: Number(options.minConfidence),
        source: options.source
      });

      if (options.json) {
        console.log(JSON.stringify(candidates, null, 2));
        return;
      }

      printCandidates(candidates);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('recall')
  .description('Search local project memories')
  .argument('<query>', 'search query')
  .option('-k, --kind <kind>', `filter by kind: ${memoryKinds.join(', ')}`)
  .option('--tag <tags>', 'filter by tag; repeat for multiple tags', (value: string, previous: string[] = []) => [...previous, value])
  .option('-l, --limit <limit>', 'maximum results', '10')
  .option('--min-score <score>', 'minimum score threshold', '0')
  .option('--json', 'print JSON output')
  .action(async (query, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const results = await store.search(config.projectId, query, {
        limit: Number(options.limit),
        kind: parseOptionalKind(options.kind),
        tags: splitTags(options.tag),
        minScore: Number(options.minScore)
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      printSearchResults(results);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('prompt')
  .description('Build an AI prompt snippet from relevant memories')
  .argument('<query>', 'search query')
  .option('-l, --limit <limit>', 'maximum memories', '8')
  .option('--max-tokens <tokens>', 'maximum prompt tokens', '1800')
  .option('--json', 'print JSON output')
  .action(async (query, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const results = await store.search(config.projectId, query, { limit: Number(options.limit) });
      const snippet = buildPromptSnippet(results, {
        maxTokens: Number(options.maxTokens),
        limit: Number(options.limit),
        projectName: config.name
      });

      if (options.json) {
        console.log(JSON.stringify(snippet, null, 2));
        return;
      }

      console.log(`Memories used: ${snippet.memoriesUsed}`);
      console.log(`Tokens: ${snippet.tokens}`);
      console.log('\n--- prompt snippet ---');
      console.log(snippet.text);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('list')
  .description('List project memories')
  .option('-k, --kind <kind>', `filter by kind: ${memoryKinds.join(', ')}`)
  .option('--tag <tags>', 'filter by tag; repeat for multiple tags', (value: string, previous: string[] = []) => [...previous, value])
  .option('-l, --limit <limit>', 'maximum results', '25')
  .option('--json', 'print JSON output')
  .action(async (options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const records = await store.list(config.projectId, {
        kind: parseOptionalKind(options.kind),
        tags: splitTags(options.tag),
        limit: Number(options.limit)
      });

      if (options.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }

      if (records.length === 0) {
        console.log('No memories found.');
        return;
      }

      for (const record of records) {
        printRecord(record);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command('forget')
  .description('Delete a memory by id')
  .argument('<id>', 'memory id')
  .option('--json', 'print JSON output')
  .action(async (id, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const deleted = await store.delete(id);

      if (options.json) {
        console.log(JSON.stringify({ deleted }, null, 2));
        return;
      }

      console.log(deleted ? `Deleted memory ${id}` : `Memory not found: ${id}`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('edit')
  .description('Update a memory')
  .argument('<id>', 'memory id')
  .argument('[content]', 'new memory content')
  .option('-t, --title <title>', 'new title')
  .option('-k, --kind <kind>', `memory kind: ${memoryKinds.join(', ')}`)
  .option('--tag <tags>', 'comma-separated tags; repeat for multiple tags', (value: string, previous: string[] = []) => [...previous, value])
  .option('--source <source>', 'source reference')
  .option('--json', 'print JSON output')
  .action(async (id, content, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const record = await store.update(id, {
        title: options.title,
        content,
        kind: parseOptionalKind(options.kind),
        tags: splitTags(options.tag),
        source: options.source
      });

      if (!record) {
        throw new Error(`Memory not found: ${id}`);
      }

      if (options.json) {
        console.log(JSON.stringify(record, null, 2));
        return;
      }

      printSaved(record);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('duplicates')
  .description('Find duplicate memories')
  .option('--threshold <score>', 'similarity threshold', '0.88')
  .option('--json', 'print JSON output')
  .action(async (options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const duplicates = await store.findDuplicates(config.projectId, Number(options.threshold));

      if (options.json) {
        console.log(JSON.stringify(duplicates, null, 2));
        return;
      }

      if (duplicates.length === 0) {
        console.log('No duplicate memories found.');
        return;
      }

      for (const duplicate of duplicates) {
        console.log(`\n${chalk.yellow(`Similarity ${duplicate.similarity.toFixed(2)}`)}`);
        console.log(`- ${duplicate.left.id}: ${duplicate.left.title}`);
        console.log(`- ${duplicate.right.id}: ${duplicate.right.title}`);
      }
    } catch (error) {
      fail(error);
    }
  });

program
  .command('doctor')
  .description('Check memory health and recommend fixes')
  .option('--json', 'print JSON output')
  .action(async (options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const report = buildDoctorReport(await store.health(config.projectId));

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log(report.ok ? chalk.green('AgentMemory looks healthy.') : chalk.yellow('AgentMemory needs attention.'));
      for (const check of report.checks) {
        console.log(`${check.ok ? '✓' : '!'} ${check.name}: ${check.message}`);
      }

      for (const recommendation of report.recommendations) {
        console.log(`- ${recommendation}`);
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
  .command('import')
  .description('Import memories from a JSON file')
  .argument('<file>', 'JSON export file')
  .option('--no-dedupe', 'do not deduplicate imported memories')
  .option('--json', 'print JSON output')
  .action(async (file, options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const records = JSON.parse(await readFile(file, 'utf8')) as MemoryRecord[];
      const imported = await store.importRecords(config.projectId, records, options.dedupe !== false);

      if (options.json) {
        console.log(JSON.stringify({ imported }, null, 2));
        return;
      }

      console.log(`Imported ${imported} memories`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('export')
  .description('Export project memories as JSON')
  .option('-o, --out <path>', 'write export to a file')
  .action(async (options) => {
    try {
      const config = await currentConfig();
      const store = new MemoryStore(config.memoryPath);
      const records = await store.export(config.projectId);
      const output = JSON.stringify(records, null, 2);

      if (options.out) {
        await writeFile(options.out, output, 'utf8');
        console.log(`Exported ${records.length} memories to ${options.out}`);
        return;
      }

      console.log(output);
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
      const health = await store.health(config.projectId);
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

      if (options.json) {
        console.log(JSON.stringify({ project: config, counts, total, health }, null, 2));
        return;
      }

      console.log(`Project: ${config.name}`);
      console.log(`Memory file: ${config.memoryPath}`);
      console.log(`Total memories: ${total}`);
      console.log(`Duplicate pairs: ${health.duplicatePairs}`);
      console.log(`Expired memories: ${health.expired}`);
      for (const [kind, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`${kind}: ${count}`);
      }
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

interface MemorySaveInput {
  kind?: MemoryKind;
  title?: string;
  content: string;
  tags?: string[];
  source?: string;
}

async function saveMemory(config: Awaited<ReturnType<typeof currentConfig>>, input: MemorySaveInput): Promise<MemoryRecord> {
  const store = new MemoryStore(config.memoryPath);
  return store.save({
    projectId: config.projectId,
    kind: input.kind,
    title: input.title,
    content: input.content,
    tags: input.tags,
    source: input.source
  });
}

function parseKind(value: unknown): MemoryKind {
  return memoryKinds.includes(value as MemoryKind) ? value as MemoryKind : 'note';
}

function parseOptionalKind(value: unknown): MemoryKind | undefined {
  return value ? parseKind(value) : undefined;
}

function printSaved(record: MemoryRecord): void {
  console.log(`Saved memory ${record.id}`);
  console.log(`Kind: ${record.kind}`);
  console.log(`Title: ${record.title}`);
}

function printRecord(record: MemoryRecord): void {
  console.log(`\n${chalk.bold(record.title)} [${record.kind}]`);
  console.log(`ID: ${record.id}`);
  console.log(record.content);
  if (record.tags.length > 0) {
    console.log(`Tags: ${record.tags.join(', ')}`);
  }
}

function printSearchResults(results: Awaited<ReturnType<MemoryStore['search']>>): void {
  if (results.length === 0) {
    console.log('No memories found.');
    return;
  }

  for (const { record, score, similarity, reasons } of results) {
    console.log(`\n${chalk.bold(record.title)} [${record.kind}] score=${score.toFixed(1)} similarity=${similarity.toFixed(2)}`);
    console.log(`Reasons: ${reasons.join(', ') || 'recency'}`);
    console.log(record.content);
    if (record.tags.length > 0) {
      console.log(`Tags: ${record.tags.join(', ')}`);
    }
  }
}

function printCandidates(candidates: MemoryCandidate[]): void {
  if (candidates.length === 0) {
    console.log('No memory candidates found.');
    return;
  }

  for (const candidate of candidates) {
    console.log(`\n${chalk.bold(candidate.title)} [${candidate.kind}] confidence=${candidate.confidence.toFixed(2)}`);
    console.log(candidate.content);
    console.log(`Reason: ${candidate.reason}`);
    if (candidate.tags.length > 0) {
      console.log(`Tags: ${candidate.tags.join(', ')}`);
    }
  }
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
