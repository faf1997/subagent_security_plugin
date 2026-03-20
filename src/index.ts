type ExecGuardConfig = {
  enabled?: boolean;
  mode?: "denylist" | "allowlist";
  allow?: string[];
  deny?: string[];
  denyWords?: string[];
  caseInsensitive?: boolean;
  blockOnRegexError?: boolean;
};

function compilePatterns(patterns: string[] | undefined, flags: string) {
  const out: RegExp[] = [];
  for (const raw of patterns ?? []) {
    if (!raw || typeof raw !== "string") continue;
    out.push(new RegExp(raw, flags));
  }
  return out;
}

export default function register(api: any) {
  const pluginCfg =
    api.config?.plugins?.entries?.[api.id]?.config ??
    api.config?.plugins?.entries?.["openclaw-security"]?.config ??
    {};

  const cfg: ExecGuardConfig = pluginCfg.exec ?? {};
  const enabled = cfg.enabled ?? true;
  if (!enabled) return;

  const flags = cfg.caseInsensitive ?? true ? "i" : "";

  let allow: RegExp[] = [];
  let deny: RegExp[] = [];
  try {
    allow = compilePatterns(cfg.allow, flags);
    deny = compilePatterns(cfg.deny, flags);
  } catch (err) {
    api.logger?.error?.(
      `[openclaw-security] invalid regex in config: ${String(err)}`,
    );
    if (cfg.blockOnRegexError ?? true) {
      // Fail closed: block all exec calls if regex config is broken.
      allow = [];
      deny = [/.*/];
    }
  }

  const denyWords = (cfg.denyWords ?? [])
    .filter((w) => typeof w === "string" && w.trim().length > 0)
    .map((w) => (cfg.caseInsensitive ?? true ? w.toLowerCase() : w));

  const mode = cfg.mode ?? "denylist";

  api.on(
    "before_tool_call",
    async (event: any, ctx: any) => {
      if (event?.toolName !== "exec") return;

      const cmd = String(event?.params?.command ?? "");
      const hay = cfg.caseInsensitive ?? true ? cmd.toLowerCase() : cmd;

      // Word denylist
      for (const w of denyWords) {
        if (!w) continue;
        if (hay.includes(w)) {
          return {
            block: true,
            blockReason: `exec blocked (denyWords match: ${w})`,
          };
        }
      }

      // Regex denylist always wins
      for (const re of deny) {
        if (re.test(cmd)) {
          return {
            block: true,
            blockReason: `exec blocked (deny pattern: ${re.source})`,
          };
        }
      }

      // Allowlist mode: must match at least one allow pattern
      if (mode === "allowlist") {
        if (allow.length === 0) {
          return {
            block: true,
            blockReason: "exec blocked (allowlist empty)",
          };
        }
        const ok = allow.some((re) => re.test(cmd));
        if (!ok) {
          return {
            block: true,
            blockReason: "exec blocked (not in allowlist)",
          };
        }
      }

      // Optional: attach ctx for logging if needed
      api.logger?.debug?.(
        `[openclaw-security] exec allowed agentId=${ctx?.agentId ?? "?"} sessionKey=${ctx?.sessionKey ?? "?"} cmd=${JSON.stringify(cmd)}`,
      );
    },
    { priority: 100 },
  );
}
