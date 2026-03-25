# openclaw-security (OpenClaw plugin)

Guardrails de seguridad para OpenClaw mediante **plugin hooks**. Su objetivo es reducir riesgos al permitir **bloquear o permitir** llamadas a herramientas peligrosas (hoy: `exec`) en base a reglas simples y auditables.

> Repo: https://github.com/faf1997/subagent_security_plugin

## Índice

- [¿Qué es?](#qué-es)
- [¿Por qué existe?](#por-qué-existe)
- [¿Cómo funciona?](#cómo-funciona)
  - [Hooks que usa](#hooks-que-usa)
  - [Lógica de decisión (orden de evaluación)](#lógica-de-decisión-orden-de-evaluación)
  - [Esquema de configuración](#esquema-de-configuración)
- [Instalación](#instalación)
  - [Pasos (install/enable)](#pasos-installenable)
  - [Configurar reglas en `openclaw.json`](#configurar-reglas-en-openclawjson)
- [Cómo probarlo](#cómo-probarlo)
  - [Caso 1: denylist](#caso-1-denylist)
  - [Caso 2: allowlist](#caso-2-allowlist)
  - [Qué esperar al bloquear](#qué-esperar-al-bloquear)
- [Notas de seguridad y límites](#notas-de-seguridad-y-límites)
- [Desarrollo](#desarrollo)

---

## ¿Qué es?

`openclaw-security` es un plugin de OpenClaw que agrega **guardrails** (barandas de seguridad) para llamadas a herramientas.

Hoy implementa:

- `exec` filtering: bloquea/permite llamadas al tool **`exec`** según:
  - `denyWords` (substrings)
  - `deny` (regex)
  - `allow` (regex) cuando el modo es `allowlist`

## ¿Por qué existe?

En OpenClaw, `exec` puede ejecutar comandos en el host/gateway. Eso es muy potente, pero también riesgoso:

- borrados accidentales (`rm -rf`, etc.)
- exfiltración / fetch de contenido (`curl`, `wget`)
- escalación (`sudo`)
- comandos con chaining (`;`, `|`, `&&`) difíciles de auditar

Este plugin permite definir reglas **explícitas, versionables y revisables** (en JSON) para:

- fallar cerrado (“block”) ante comandos prohibidos
- operar en allowlist cuando querés restringir a un set mínimo de comandos permitidos

## ¿Cómo funciona?

### Hooks que usa

Implementa 2 hooks principales:

- `before_agent_start`: inyecta un aviso breve en el prompt del agente informando que `exec` puede ser bloqueado. Esto reduce bucles de retry e intentos de bypass.
- `before_tool_call`: intercepta tool calls antes de ejecutarse. Si decide bloquear, devuelve `{ block: true, blockReason: "..." }`.

### Lógica de decisión (orden de evaluación)

Para una llamada `exec` (comando `params.command`):

1) **denyWords**: si el comando contiene alguno de los `denyWords` → **bloquea**
2) **deny regex**: si matchea algún patrón en `deny` → **bloquea**
3) Si `mode = allowlist`:
   - si `allow` está vacío → **bloquea**
   - si no matchea ningún patrón en `allow` → **bloquea**
4) Si nada disparó bloqueo → **permite**

> Importante: `deny` siempre “gana” (aunque también matchee allow).

### Esquema de configuración

El schema vive en [`openclaw.plugin.json`](./openclaw.plugin.json). En resumen:

- `exec.enabled` (bool, default `true`): habilita la lógica
- `exec.mode` (`denylist`|`allowlist`, default `denylist`)
- `exec.allow` (array de strings regex): patrones permitidos (solo en allowlist)
- `exec.deny` (array de strings regex): patrones bloqueados
- `exec.denyWords` (array de strings): palabras/substrings bloqueadas
- `exec.caseInsensitive` (bool, default `true`): flags `i` para regex + normalización de denyWords
- `exec.blockOnRegexError` (bool, default `true`): si hay regex inválida, **bloquea todo** (`deny = /.*/`)

---

## Instalación

La forma recomendada de instalar este plugin es usando el **CLI de OpenClaw** (comandos `plugins install/enable`).

> Si preferís una guía más corta, ver también: [`INSTALL.md`](./INSTALL.md)

### Pasos (install/enable)

1) Clonar el repo en algún directorio accesible por OpenClaw (por ejemplo `user_plugins/` o un directorio personalizado):

```bash
git clone git@github.com:faf1997/subagent_security_plugin.git /ruta/al/plugin
```

2) Instalar el plugin indicando el **absolute path** al directorio del plugin:

```bash
node dist/index.js plugins install /ruta/al/plugin
```

3) Habilitar el plugin:

```bash
node dist/index.js plugins enable openclaw-security
```

4) Reiniciar el Gateway (o el contenedor) para que tome el cambio.

> Nota: `node dist/index.js ...` se ejecuta desde el directorio de OpenClaw (donde exista `dist/index.js`).

### Configurar reglas en `openclaw.json`

Una vez habilitado, agregá la configuración del plugin en `plugins.entries`.

El plugin soporta:

- **Reglas por agente (recomendado)**: `exec.policies.<agentId>.allow/deny/denyWords`
- **Regla default**: `exec.defaultPolicy` (fallback)
- **Legacy**: `exec.allow/deny/denyWords/mode` (si no definís `policies`)

```json5
{
  plugins: {
    entries: {
      "openclaw-security": {
        enabled: true,
        config: {
          exec: {
            enabled: true,
            caseInsensitive: true,
            blockOnRegexError: true,

            // Fallback si un agentId no tiene policy
            defaultPolicy: {
              mode: "denylist",
              deny: ["[;&|`$<>\\n\\r]"]
            },

            // Policies por agente
            policies: {
              security_proof: {
                mode: "allowlist",
                allow: ["^git status$"],
                deny: ["\\brm\\b", "\\bsudo\\b"],
                denyWords: ["curl", "wget"]
              },
              augusto: {
                mode: "allowlist",
                allow: ["^python3 /home/node/\\.openclaw/workspace-augusto/tools/augusto_helpdesk\\.py .*$"],
                deny: ["[;&|`$<>\\n\\r]"]
              }
            }
          }
        }
      }
    }
  }
}
```

---

## Cómo probarlo

### Caso 1: denylist

Config:

- `mode: "denylist"`
- `denyWords: ["curl"]`

Prueba:

1) En un agente con tool `exec` habilitado, intentar ejecutar:

- `curl https://example.com`

Resultado esperado:

- El tool call se **bloquea** con un error tipo:
  - `exec blocked (denyWords match: curl)`

### Caso 2: allowlist

Config:

- `mode: "allowlist"`
- `allow: ["^git status$"]`

Prueba:

1) Ejecutar:

- `git status` → **permitido**
- `git diff` → **bloqueado** (`not in allowlist`)

Resultado esperado:

- `git status` se ejecuta normalmente
- `git diff` devuelve:
  - `exec blocked (not in allowlist)`

### Qué esperar al bloquear

Cuando el plugin bloquea:

- OpenClaw no ejecuta el comando
- el agente recibe una respuesta de tool con `blockReason`
- además el plugin loguea (debug) cuando permite `exec`:

```
[openclaw-security] exec allowed agentId=... sessionKey=... cmd="..."
```

---

## Notas de seguridad y límites

- Este plugin **no reemplaza** controles del sistema (usuarios, permisos, contenedores, firewall, etc.). Es una capa adicional.
- Regex + denyWords son potentes pero pueden ser frágiles. Recomendación:
  - en allowlist usar patrones **anclados** `^...$`
  - evitar reglas “sueltas” que permitan cadenas peligrosas
- `blockOnRegexError=true` hace que ante una regex inválida el sistema **falle cerrado** (recomendado).
- Actualmente filtra solo `exec`. Extenderlo a otros tools es posible agregando condiciones en `before_tool_call`.

---

## Desarrollo

- Entry point: [`src/index.ts`](./src/index.ts)
- Dependencias mínimas en [`package.json`](./package.json)
- Metadata/schema UI: [`openclaw.plugin.json`](./openclaw.plugin.json)

Sugerencia para evolución:

- pasar de regex shell a un “runner” seguro (subprocess sin shell, validación estricta de args)
- agregar métricas/telemetría por bloqueos
- permitir scoping por agentId/sessionKey (políticas por agente)
