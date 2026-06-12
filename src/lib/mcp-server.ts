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
import { ensureProjectConfig, resolveProjectRoot } from './paths.js';
import { MemoryStore } from './memory-store.js';
import { memoryKinds, type MemoryKind } from './types.js';

const PACKAGE_VERSION = '0.1.0';

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
    limit: z.number().int().min(1).max(50).optional().default(10)
  });

  const compressSchema = z.object({
    text: z.string(),
    maxTokens: z.number().int().min(100).max(200000).optional().default(4000)
  });

  const statusSchema = z.object({}).passthrough();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'agentmemory_remember',
        description: 'Save a durable project memory for the current AI agent session.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: memoryKinds },
            title: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            source: { type: 'string' }
          },
          required: ['content']
        }
      },
      {
        name: 'agentmemory_recall',
        description: 'Search local project memories by query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          },
          required: ['query']
        }
      },
      {
        name: 'agentmemory_compress',
        description: 'Compress logs, files, or long text before sending it to an AI model.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            maxTokens: { type: 'number' }
          },
          required: ['text']
        }
      },
      {
        name: 'agentmemory_status',
        description: 'Return local memory counts for the current project.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
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
          return toolSuccess(await store.search(config.projectId, parsed.query, parsed.limit));
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

        case 'agentmemory_status': {
          statusSchema.parse(parsedArgs);
          const counts = await store.count(config.projectId);
          return toolSuccess({
            project: {
              projectId: config.projectId,
              name: config.name,
              root: config.root,
              memoryPath: config.memoryPath
            },
            counts,
            total: Object.values(counts).reduce((sum, count) => sum + count, 0)
          });
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
