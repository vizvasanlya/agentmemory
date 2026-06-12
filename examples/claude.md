# Claude Desktop MCP config

Add this to `claude_desktop_config.json`.

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

If running from source before publishing:

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/absolute/path/to/agentmemory"
    }
  }
}
```

Restart Claude Desktop after saving the config.
