# subagent_security_plugin

Plugin de OpenClaw que provee tools **opcionales** para que los subagentes ejecuten un **worker Python local persistente** a través de un pipe estricto **JSONL por stdin/stdout**.

## Por qué

- Querés que los subagentes **nunca** tengan acceso a `exec`.
- Aun así necesitás ejecutar acciones locales específicas (implementadas en Python).
- Por lo tanto: exponer **solo** tools de alcance acotado, que enrutan todo a través de un proceso Python controlado.

## Qué provee este plugin

Tools (todas registradas como `optional: true`):

- `python_pipe_echo` — operación rígida: `echo`
- `python_pipe_sha256` — operación rígida: `sha256`
- `python_pipe_call` — llamada genérica a una operación en whitelist (`allowedOps`)

> Recomendación de seguridad: para subagentes, preferí las tools rígidas (`python_pipe_echo`, `python_pipe_sha256`) y evitá allowlistear `python_pipe_call` salvo que realmente lo necesites.

## Worker Python

- Ruta: `worker/worker.py`
- Protocolo: JSONL por stdin/stdout

Request:
```json
{"id":"uuid","op":"sha256","params":{"text":"hello"}}
```

Response:
```json
{"id":"uuid","ok":true,"result":{"sha256":"..."}}
```

## Configuración

En `~/.openclaw/openclaw.json`:

1) Cargar/habilitar el plugin (el ejemplo usa `plugins.load.paths`):

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

2) Forzar la política de tools para subagentes (denegar `exec`, permitir solo estas tools):

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

Reiniciá el gateway después de cambios de config/plugin:

```bash
openclaw gateway restart
```

## Extender con nuevas operaciones

Agregá una nueva operación en `worker/worker.py` (e incluila en `OPS`). Luego, podés:

- Agregarla a `allowedOps` y llamarla vía `python_pipe_call` (menos estricto), o
- Agregar una nueva tool rígida en `src/index.ts` que llame siempre esa operación (recomendado para seguridad de subagentes).

## Notas

- Este plugin corre **in-process** con el Gateway de OpenClaw (código confiable).
- El modelo **no** recibe `exec`; solo tu plugin spawnea Python.
