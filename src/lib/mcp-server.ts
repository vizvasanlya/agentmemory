import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { compressContext } from './compression.js';
import { buildDoctorReport } from './doctor.js';
import { suggestMemories } from './learning.js';
import { ensureProjectConfig, resolveProjectRoot } from './paths.js';
import { buildPromptSnippet } from './prompt.js';
import { MemoryStore } from './memory-store.js';
import { memoryKinds, type MemoryCandidate, type MemoryKind } from './types.js';

const PACKAGE_VERSION = '0.2.0';

export interface McpServerOptions {
  projectRoot?: string;
  memoryPath?: string;
}

function toolSuccess(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value as Record<string, unknown>
  };
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message
      }
    ]
  };
}

export async function createAgentMemoryServer(options: McpServerOptions = {}): Promise<Server> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const config = await ensureProjectConfig(projectRoot, { memoryPath: options.memoryPath });
  const store = new MemoryStore(config.memoryPath);
  const server = new Server(
    { name: 'agentmemory', version: PACKAGE_VERSION },
    { capabilities: { resources: {}, tools: {} } }
  );

  const rememberSchema = z.object({
    kind: z.enum(memoryKinds).optional().default('note'),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    tags: z.array(z.string()).optional().default([]),
    source: z.string().optional()
  });

  const recallSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional().default(10),
    kind: z.enum(memoryKinds).optional(),
    minScore: z.number().optional().default(0)
  });

  const compressSchema = z.object({
    text: z.string(),
    maxTokens: z.number().int().min(100).max(200000).optional().default(4000)
  });

  const learnSchema = z.object({
    text: z.string(),
    maxCandidates: z.number().int().min(1).max(50).optional().default(8),
    minConfidence: z.number().min(0).max(1).optional().default(0.45),
    source: z.string().optional(),
    save: z.boolean().optional().default(true)
  });

  const promptSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional().default(8),
    maxTokens: z.number().int().min(100).max(20000).optional().default(1800)
  });

  const duplicatesSchema = z.object({
    threshold: z.number().min(0).max(1).optional().default(0.88)
  });

  const forgetSchema = z.object({
    id: z.string().min(1)
  });

  const listSchema = z.object({
    kind: z.enum(memoryKinds).optional(),
    limit: z.number().int().min(1).max(100).optional().default(25)
  });

  const statusSchema = z.object({}).passthrough();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'agentmemory_remember',
        description: 'Save a durable project memory for the current AI agent session.',
        inputSchema: objectSchema(['content', 'kind', 'title', 'tags', 'source'])
      },
      {
        name: 'agentmemory_recall',
        description: 'Search local project memories by query with vector-like ranking.',
        inputSchema: objectSchema(['query', 'limit', 'kind', 'minScore'])
      },
      {
        name: 'agentmemory_compress',
        description: 'Compress logs, files, or long text before sending it to an AI model.',
        inputSchema: objectSchema(['text', 'maxTokens'])
      },
      {
        name: 'agentmemory_learn',
        description: 'Extract memory candidates from text and optionally save them.',
        inputSchema: objectSchema(['text', 'maxCandidates', 'minConfidence', 'source', 'save'])
      },
      {
        name: 'agentmemory_prompt',
        description: 'Build a ready-to-use prompt snippet from relevant memories.',
        inputSchema: objectSchema(['query', 'limit', 'maxTokens'])
      },
      {
        name: 'agentmemory_duplicates',
        description: 'Find duplicate memories.',
        inputSchema: objectSchema(['threshold'])
      },
      {
        name: 'agentmemory_forget',
        description: 'Delete a memory by id.',
        inputSchema: objectSchema(['id'])
      },
      {
        name: 'agentmemory_list',
        description: 'List project memories.',
        inputSchema: objectSchema(['kind', 'limit'])
      },
      {
        name: 'agentmemory_status',
        description: 'Return local memory counts and health.',
        inputSchema: objectSchema([])
      }
    ]
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: memoryResourceUri(config.projectId),
        name: 'AgentMemory project memory',
        mimeType: 'application/json',
        description: 'Local project memories stored by AgentMemory.'
      }
    ]
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    if (request.params.uri !== memoryResourceUri(config.projectId)) {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: 'text/plain',
            text: `Unknown resource: ${request.params.uri}`
          }
        ]
      };
    }

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            project: {
              projectId: config.projectId,
              name: config.name,
              root: config.root,
              memoryPath: config.memoryPath
            },
            memories: await store.export(config.projectId)
          }, null, 2)
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const parsedArgs = args ?? {};

    try {
      switch (name) {
        case 'agentmemory_remember': {
          const parsed = rememberSchema.parse(parsedArgs);
          const record = await store.save({
            projectId: config.projectId,
            kind: parsed.kind as MemoryKind,
            title: parsed.title,
            content: parsed.content,
            tags: parsed.tags,
            source: parsed.source
          });

          return toolSuccess(record);
        }

        case 'agentmemory_recall': {
          const parsed = recallSchema.parse(parsedArgs);
          return toolSuccess(await store.search(config.projectId, parsed.query, {
            limit: parsed.limit,
            kind: parsed.kind as MemoryKind | undefined,
            minScore: parsed.minScore
          }));
        }

        case 'agentmemory_compress': {
          const parsed = compressSchema.parse(parsedArgs);
          const result = compressContext(parsed.text, { maxTokens: parsed.maxTokens });
          return toolSuccess({
            originalTokens: result.originalTokens,
            compressedTokens: result.compressedTokens,
            removedTokens: result.removedTokens,
            compressionRatio: result.compressionRatio,
            compressedText: result.compressedText
          });
        }

        case 'agentmemory_learn': {
          const parsed = learnSchema.parse(parsedArgs);
          const candidates = suggestMemories(parsed.text, {
            maxCandidates: parsed.maxCandidates,
            minConfidence: parsed.minConfidence,
            source: parsed.source
          });

          if (!parsed.save) {
            return toolSuccess({ candidates, saved: [], skipped: [] });
          }

          const saved: MemoryCandidate[] = [];
          for (const candidate of candidates) {
            await store.save({
              projectId: config.projectId,
              kind: candidate.kind,
              title: candidate.title,
              content: candidate.content,
              tags: candidate.tags,
              source: candidate.reason
            });
            saved.push(candidate);
          }

          return toolSuccess({ candidates, saved, skipped: [] });
        }

        case 'agentmemory_prompt': {
          const parsed = promptSchema.parse(parsedArgs);
          const results = await store.search(config.projectId, parsed.query, { limit: parsed.limit });
          return toolSuccess(buildPromptSnippet(results, {
            maxTokens: parsed.maxTokens,
            limit: parsed.limit,
            projectName: config.name
          }));
        }

        case 'agentmemory_duplicates': {
          const parsed = duplicatesSchema.parse(parsedArgs);
          return toolSuccess(await store.findDuplicates(config.projectId, parsed.threshold));
        }

        case 'agentmemory_forget': {
          const parsed = forgetSchema.parse(parsedArgs);
          return toolSuccess({ deleted: await store.delete(parsed.id) });
        }

        case 'agentmemory_list': {
          const parsed = listSchema.parse(parsedArgs);
          return toolSuccess(await store.list(config.projectId, {
            kind: parsed.kind as MemoryKind | undefined,
            limit: parsed.limit
          }));
        }

        case 'agentmemory_status': {
          statusSchema.parse(parsedArgs);
          const counts = await store.count(config.projectId);
          const health = await store.health(config.projectId);
          return toolSuccess({
            project: {
              projectId: config.projectId,
              name: config.name,
              root: config.root,
              memoryPath: config.memoryPath
            },
            counts,
            health,
            total: Object.values(counts).reduce((sum, count) => sum + count, 0)
          });
        }

        case 'agentmemory_doctor': {
          const health = await store.health(config.projectId);
          return toolSuccess(buildDoctorReport(health));
        }

        default:
          return toolError(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}

export async function runMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = await createAgentMemoryServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function memoryResourceUri(projectId: string): string {
  return `agentmemory://${projectId}/memory`;
}

function objectSchema(properties: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(properties.map((property) => [property, { type: property === 'limit' || property === 'maxTokens' || property === 'maxCandidates' || property === 'minConfidence' || property === 'minScore' || property === 'threshold' ? 'number' : 'string' }])),
    required: properties.filter((property) => !['kind', 'title', 'tags', 'source', 'limit', 'minScore', 'maxTokens', 'maxCandidates', 'minConfidence', 'threshold', 'save'].includes(property))
  };
}
