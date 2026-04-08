function compilePatterns(patterns, flags) {
    const out = [];
    for (const raw of patterns ?? []) {
        if (!raw || typeof raw !== "string")
            continue;
        out.push(new RegExp(raw, flags));
    }
    return out;
}
export default function register(api) {
    const pluginCfg = api.config?.plugins?.entries?.[api.id]?.config ??
        api.config?.plugins?.entries?.["openclaw-security"]?.config ??
        {};
    const cfg = pluginCfg.exec ?? {};
    const enabled = cfg.enabled ?? true;
    if (!enabled)
        return;
    // Make the policy explicit to *all* agents (main + subagents) at runtime.
    // This helps models interpret the tool error correctly and avoid retry loops.
    api.on("before_agent_start", async (event) => {
        const hasPerAgent = !!(cfg.policies && Object.keys(cfg.policies).length);
        const mode = cfg.mode ?? "denylist";
        const policyText = `\n\n[openclaw-security]\n` +
            `Policy: exec tool calls may be blocked by security rules. ` +
            (hasPerAgent
                ? `Per-agent policies are enabled (default mode: ${mode}). `
                : `Mode: ${mode}. `) +
            `If an exec call is blocked you will receive an error message like ` +
            `"exec blocked (...)". Do NOT attempt to bypass the block; instead, ` +
            `ask the user for an allowed alternative (or request a config change).\n`;
        // Best-effort: append a short notice; do not fail the run if the shape changes.
        if (typeof event?.systemPrompt === "string") {
            event.systemPrompt += policyText;
        }
        else if (typeof event?.system === "string") {
            event.system += policyText;
        }
    });
    const flags = cfg.caseInsensitive ?? true ? "i" : "";
    const compilePolicy = (p) => {
        const mode = (p?.mode ?? cfg.mode ?? "denylist");
        let allow = [];
        let deny = [];
        try {
            allow = compilePatterns(p?.allow ?? [], flags);
            deny = compilePatterns(p?.deny ?? [], flags);
        }
        catch (err) {
            api.logger?.error?.(`[openclaw-security] invalid regex in config: ${String(err)}`);
            if (cfg.blockOnRegexError ?? true) {
                allow = [];
                deny = [/.*/];
            }
        }
        const denyWords = (p?.denyWords ?? [])
            .filter((w) => typeof w === "string" && w.trim().length > 0)
            .map((w) => (cfg.caseInsensitive ?? true ? w.toLowerCase() : w));
        return { mode, allow, deny, denyWords };
    };
    // Back-compat: if no policies/defaultPolicy are provided, use legacy fields.
    const legacyPolicy = {
        mode: cfg.mode,
        allow: cfg.allow ?? [],
        deny: cfg.deny ?? [],
        denyWords: cfg.denyWords ?? [],
    };
    const defaultCompiled = compilePolicy(cfg.defaultPolicy ?? legacyPolicy);
    // Compile per-agent policies once (cache). Missing agents fall back to defaultCompiled.
    const compiledByAgent = new Map();
    for (const [agentId, pol] of Object.entries(cfg.policies ?? {})) {
        compiledByAgent.set(agentId, compilePolicy(pol));
    }
    api.on("before_tool_call", async (event, ctx) => {
        if (event?.toolName !== "exec")
            return;
        const cmd = String(event?.params?.command ?? "");
        const hay = cfg.caseInsensitive ?? true ? cmd.toLowerCase() : cmd;
        const agentId = String(ctx?.agentId ?? "");
        const pol = compiledByAgent.get(agentId) ?? defaultCompiled;
        // Word denylist
        for (const w of pol.denyWords) {
            if (!w)
                continue;
            if (hay.includes(w)) {
                return {
                    block: true,
                    blockReason: `exec blocked (denyWords match: ${w})`,
                };
            }
        }
        // Regex denylist always wins
        for (const re of pol.deny) {
            if (re.test(cmd)) {
                return {
                    block: true,
                    blockReason: `exec blocked (deny pattern: ${re.source})`,
                };
            }
        }
        // Allowlist mode: must match at least one allow pattern
        if (pol.mode === "allowlist") {
            if (pol.allow.length === 0) {
                return {
                    block: true,
                    blockReason: "exec blocked (allowlist empty)",
                };
            }
            const ok = pol.allow.some((re) => re.test(cmd));
            if (!ok) {
                return {
                    block: true,
                    blockReason: "exec blocked (not in allowlist)",
                };
            }
        }
        // Optional: attach ctx for logging if needed
        api.logger?.debug?.(`[openclaw-security] exec allowed agentId=${ctx?.agentId ?? "?"} sessionKey=${ctx?.sessionKey ?? "?"} cmd=${JSON.stringify(cmd)}`);
    }, { priority: 100 });
}
