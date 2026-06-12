# AgentMemory

Local-first memory, learning, prompt context, and compression for AI coding agents.

AgentMemory gives Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, Aider, OpenCode, Cline, and other MCP-compatible agents durable project memory without sending private context to a cloud service.

## What it does

- Saves project decisions, architecture notes, bug history, preferences, tasks, and facts locally.
- Learns memory candidates from project notes, session transcripts, logs, and docs.
- Searches memories with vector-like ranking over title, tags, and content.
- Builds ready-to-use prompt snippets for AI agents.
- Compresses large logs/files before they enter an AI context window.
- Indexes project structure and stores it as memory.
- Finds duplicate memories and reports memory health.
- Exposes a full MCP server for coding agents.
- Works without telemetry or a required cloud account.

## Install from npm

```bash
npm install -g @vizvasanlya/agentmemory
```

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

Learn memories from text, a file, or stdin:

```bash
cat NOTES.md | agentmemory learn --source notes
agentmemory learn docs/architecture.md --source docs
agentmemory learn --dry-run < session.txt
```

Preview memory candidates without saving:

```bash
agentmemory suggest README.md --source readme
```

Search memories:

```bash
agentmemory recall "payment retry"
agentmemory recall "architecture" --kind architecture --tag api
```

Build an AI prompt snippet from relevant memories:

```bash
agentmemory prompt "payment flow" > /tmp/agentmemory-prompt.md
```

List memories:

```bash
agentmemory list
agentmemory list --kind bug
```

Update or delete memories:

```bash
agentmemory edit <memory-id> "New memory content" --title "New title"
agentmemory forget <memory-id>
```

Find duplicate memories:

```bash
agentmemory duplicates
agentmemory duplicates --threshold 0.75
```

Run a health check:

```bash
agentmemory doctor
```

Compress a file:

```bash
agentmemory compress logs.txt --max-tokens 2000
```

Index the project:

```bash
agentmemory index
```

Import and export memories:

```bash
agentmemory export -o memories.json
agentmemory import memories.json
```

Show status:

```bash
agentmemory status
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
- `agentmemory_learn`
- `agentmemory_prompt`
- `agentmemory_duplicates`
- `agentmemory_forget`
- `agentmemory_list`
- `agentmemory_status`
- `agentmemory_doctor`

It also exposes one resource:

- `agentmemory://{projectId}/memory`

## Example Claude Desktop config

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

## Why this matters

AI coding agents are powerful, but they often lose project context between sessions. AgentMemory solves that with a local memory layer that can be used by any MCP-compatible agent.

The workflow is:

1. Run `agentmemory init` in your project.
2. Save decisions, architecture notes, and bug fixes with `remember`.
3. Learn from docs and session transcripts with `learn`.
4. Ask your agent to recall relevant memories with `recall` or MCP.
5. Generate compact prompt context with `prompt`.
6. Compress large logs with `compress`.
7. Keep memory clean with `doctor` and `duplicates`.

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
    doctor.ts
    learning.ts
    memory-store.ts
    mcp-server.ts
    paths.ts
    prompt.ts
    repo-indexer.ts
    tokens.ts
    types.ts
tests/
```

## Roadmap

- Optional local embeddings for stronger semantic recall.
- Per-agent prompt templates for Claude Code, Codex, Gemini CLI, Cursor, and OpenCode.
- Automatic memory suggestions after long sessions.
- Memory importers for Slack, Linear, GitHub issues, and Notion.
- Encrypted team sync for organizations.
- Benchmarks for token savings and retrieval quality.
