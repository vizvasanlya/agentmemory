# AgentMemory

Local-first memory and context compression for AI coding agents.

AgentMemory gives Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, Aider, and other MCP-compatible agents a durable project memory without sending private context to a cloud service.

## What it does

- Saves project decisions, architecture notes, bug history, preferences, and task context locally.
- Searches saved memories from the CLI or through MCP.
- Compresses large logs/files before they enter an AI context window.
- Indexes a project structure and stores it as memory.
- Works without telemetry or a required cloud account.

## Install from source

```bash
npm install
npm run build
npm link
```

## CLI commands

Initialize the current project:

```bash
agentmemory init
```

Save a memory:

```bash
agentmemory remember "Use PostgreSQL for durable local memory" --kind decision --tag memory --tag local
```

Search memories:

```bash
agentmemory recall "payment retry"
```

Compress a file:

```bash
agentmemory compress logs.txt --max-tokens 2000
```

Index the project:

```bash
agentmemory index
```

Show status:

```bash
agentmemory status
```

Export memories:

```bash
agentmemory export
```

Start the MCP server:

```bash
agentmemory mcp
```

## MCP tools

AgentMemory exposes these MCP tools:

- `agentmemory_remember`
- `agentmemory_recall`
- `agentmemory_compress`
- `agentmemory_status`

It also exposes one resource:

- `agentmemory://{projectId}/memory`

## Claude Desktop config

Replace the command path with your installed binary path.

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "agentmemory",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

On macOS, the Claude Desktop config is usually:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

On Windows, it is usually:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

## Development

```bash
npm run dev
npm run build
npm run typecheck
npm test
npm run lint
```

## Project layout

```text
src/
  cli.ts
  mcp.ts
  index.ts
  lib/
    compression.ts
    memory-store.ts
    mcp-server.ts
    paths.ts
    repo-indexer.ts
    tokens.ts
    types.ts
tests/
```

## Roadmap

- Better semantic search with optional local embeddings.
- Per-agent prompt templates.
- Automatic memory suggestions after long sessions.
- Team sync through an optional encrypted remote backend.
- Benchmarks for token savings and retrieval quality.
