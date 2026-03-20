# OpenClaw Security (plugin)

This plugin adds guardrails via **plugin hooks**, currently:

- `before_tool_call`: filter/block `exec` tool calls using regex + word rules.

## Install (local path)

1) Point OpenClaw to the plugin (load path / install method depends on your setup).
2) Enable the plugin entry in `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "openclaw-security": {
        enabled: true,
        config: {
          exec: {
            enabled: true,
            mode: "denylist", // or "allowlist"
            denyWords: ["curl", "wget"],
            deny: ["\\brm\\b", "\\bsudo\\b"],
            allow: ["^git (status|diff)$"],
            caseInsensitive: true,
            blockOnRegexError: true
          }
        }
      }
    }
  }
}
```

## Notes

- `deny` patterns always block.
- In `allowlist` mode, `allow` must match at least one pattern.
- Keep patterns tight; prefer argv-like regexes anchored with `^...$`.
