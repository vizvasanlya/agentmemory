#!/usr/bin/env node
import { runMcpServer } from './lib/mcp-server.js';

runMcpServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
