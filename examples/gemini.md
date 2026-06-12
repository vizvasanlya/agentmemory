# Gemini CLI MCP config

If your Gemini CLI version supports MCP server configuration, use:

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

From source:

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
