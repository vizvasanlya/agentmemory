# AgentMemory quickstart

```bash
npm install -g @vizvasanlya/agentmemory
cd your-project
agentmemory init
```

Save a project decision:

```bash
agentmemory remember "Use PostgreSQL for durable local memory" --kind decision --tag database --tag architecture
```

Learn from project notes:

```bash
cat NOTES.md | agentmemory learn --source notes
```

Ask for relevant memories before an agent session:

```bash
agentmemory prompt "payment retry behavior"
```

Compress a large log before sending it to an AI model:

```bash
agentmemory compress logs.txt --max-tokens 2000
```

Check memory health:

```bash
agentmemory doctor
```
