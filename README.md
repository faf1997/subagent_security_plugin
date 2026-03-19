# subagent_security_plugin

OpenClaw plugin that provides **optional** tools for sub-agents to run a **persistent local Python worker** via a strict stdin/stdout JSONL pipe.

## Why

- You want sub-agents to **never** have access to `exec`.
- You still need to run specific local actions (implemented in Python).
- Therefore: expose **only** narrowly-scoped tools that route through a controlled Python process.

## What this plugin provides

Tools (all registered as `optional: true`):

- `python_pipe_echo` — rigid op: `echo`
- `python_pipe_sha256` — rigid op: `sha256`
- `python_pipe_call` — generic whitelisted op call (`allowedOps`)

> Security recommendation: for sub-agents, prefer the rigid tools (`python_pipe_echo`, `python_pipe_sha256`) and avoid allowlisting `python_pipe_call` unless you really need it.

## Python worker

- Path: `worker/worker.py`
- Protocol: JSONL over stdin/stdout

Request:
```json
{"id":"uuid","op":"sha256","params":{"text":"hello"}}
```

Response:
```json
{"id":"uuid","ok":true,"result":{"sha256":"..."}}
```

## Configuration

In `~/.openclaw/openclaw.json`:

1) Load/enable the plugin (example uses `plugins.load.paths`):

```json5
{
  plugins: {
    load: { paths: ["/ABS/PATH/subagent_security_plugin"] },
    entries: {
      "subagent-security-python-pipe": {
        enabled: true,
        config: {
          pythonBin: "python3",
          workerPath: "{pluginDir}/worker/worker.py",
          allowedOps: ["echo", "sha256"],
          requestTimeoutMs: 15000,
          maxOutputBytes: 262144
        }
      }
    }
  }
}
```

2) Enforce sub-agent tool policy (deny `exec`, allow only these tools):

```json5
{
  tools: {
    deny: ["exec", "bash", "process"],
    subagents: {
      tools: {
        deny: ["exec", "bash", "process"],
        allow: ["python_pipe_echo", "python_pipe_sha256"]
      }
    }
  }
}
```

Restart the gateway after config/plugin changes:

```bash
openclaw gateway restart
```

## Extending with new ops

Add a new operation in `worker/worker.py` (and include it in `OPS`). Then either:

- Add it to `allowedOps` and call it via `python_pipe_call` (less strict), or
- Add a new rigid tool in `src/index.ts` that always calls that op (recommended for sub-agent safety).

## Notes

- This plugin runs in-process with the OpenClaw Gateway (trusted code).
- The model does **not** get `exec`; only your plugin spawns Python.
