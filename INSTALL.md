# Ejemplo: plugin de tools opcionales (OpenClaw + TypeScript)

Este proyecto es un ejemplo mínimo de **plugin** que registra una tool **opcional** (opt‑in).

- Plugin id: `example-optional-tools`
- Tool opcional: `hello_optional`

La tool **no aparece** para el modelo a menos que la **allowlistees** en `openclaw.json`.

---

## 1) Ubicación

Podés dejar este repo/carpeta en cualquier ruta del servidor.
Ejemplo (workspace):

```
/home/node/.openclaw/workspace-main/example_optional_tool_plugin
```

---

## 2) Configurar OpenClaw para cargar el plugin

Editá `~/.openclaw/openclaw.json` y agregá:

```json5
{
  plugins: {
    load: {
      paths: [
        "/home/node/.openclaw/workspace-main/example_optional_tool_plugin"
      ]
    },
    entries: {
      "example-optional-tools": {
        enabled: true,
        config: {
          defaultName: "mundo"
        }
      }
    }
  }
}
```

> Nota: el `id` debe coincidir con `openclaw.plugin.json`.

---

## 3) Habilitar (allowlist) la tool opcional

Como la tool se registró con `{ optional: true }`, **NO** se habilita sola.

Para habilitarla, agregala a una allowlist (global o por agente).

### Opción A: allowlist global

```json5
{
  tools: {
    allow: ["hello_optional"]
  }
}
```

### Opción B: allowlist solo para un agente

```json5
{
  agents: {
    list: [
      {
        id: "main",
        tools: { allow: ["hello_optional"] }
      }
    ]
  }
}
```

### Opción C (típica para subagentes): solo subagentes

```json5
{
  tools: {
    subagents: {
      tools: {
        allow: ["hello_optional"],
        deny: ["exec", "bash", "process"]
      }
    }
  }
}
```

---

## 4) Reiniciar el Gateway

Después de cambiar plugins/config:

```bash
openclaw gateway restart
```

---

## 5) Probar

Pedile al agente algo como:

- "Usá la tool hello_optional para saludar a Francisco"

Si la tool está allowlisteada, el modelo podrá invocarla.

---

## Notas de seguridad

- Las tools opcionales son opt-in, pero igual conviene usar **allowlist estricta**.
- Para subagentes, usá `tools.subagents.tools.allow/deny` para que siempre tengan el mismo perímetro.
