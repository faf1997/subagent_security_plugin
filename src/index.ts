import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";

type PluginCfg = {
  pythonBin?: string;
  workerPath?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxOutputBytes?: number;
  allowedOps?: string[];
};

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timeout: NodeJS.Timeout;
};

class PersistentPythonWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private outputBytes = 0;

  constructor(
    private readonly cfg: Required<Pick<PluginCfg, "pythonBin" | "workerPath" | "startupTimeoutMs" | "requestTimeoutMs" | "maxOutputBytes">>,
    private readonly logger: any,
  ) {}

  async start() {
    if (this.proc) return;

    const python = this.cfg.pythonBin;
    const workerPath = this.cfg.workerPath;

    this.logger.info(`[subagent-security-python-pipe] starting worker: ${python} ${workerPath}`);

    const proc = spawn(python, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // force unbuffered IO
        PYTHONUNBUFFERED: "1",
      },
    });

    this.proc = proc;

    proc.on("exit", (code, signal) => {
      this.logger.warn(`[subagent-security-python-pipe] worker exited code=${code} signal=${signal}`);
      this.proc = null;
      for (const [id, p] of this.pending.entries()) {
        clearTimeout(p.timeout);
        p.reject(new Error(`python worker exited while request pending (id=${id})`));
      }
      this.pending.clear();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf-8");
      // keep it short in logs
      this.logger.warn(`[subagent-security-python-pipe][py stderr] ${s.slice(0, 2000)}`);
    });

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      this.outputBytes += Buffer.byteLength(line, "utf-8") + 1;
      if (this.outputBytes > this.cfg.maxOutputBytes) {
        this.logger.error(`[subagent-security-python-pipe] maxOutputBytes exceeded; killing worker`);
        this.kill();
        return;
      }

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        this.logger.warn(`[subagent-security-python-pipe] non-JSON line from worker: ${line.slice(0, 400)}`);
        return;
      }

      const id = msg?.id;
      if (!id || !this.pending.has(id)) return;
      const p = this.pending.get(id)!;
      clearTimeout(p.timeout);
      this.pending.delete(id);

      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "python worker error"));
    });

    // simple ready check: ping echo
    const started = await Promise.race([
      this.call("echo", { text: "ready" }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("worker startup timeout")), this.cfg.startupTimeoutMs)),
    ]);

    if (started?.text !== "ready") {
      throw new Error("worker failed readiness check");
    }

    this.logger.info(`[subagent-security-python-pipe] worker ready`);
  }

  kill() {
    if (!this.proc) return;
    try {
      this.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    this.proc = null;
  }

  async call(op: string, params: any) {
    await this.start();
    if (!this.proc) throw new Error("worker not running");

    const id = randomUUID();

    const payload = JSON.stringify({ id, op, params });
    this.outputBytes = 0;

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`python worker timeout after ${this.cfg.requestTimeoutMs}ms (op=${op})`));
      }, this.cfg.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });

    this.proc.stdin.write(payload + "\n");
    return promise;
  }
}

function resolvePluginDirFromConfig(api: any): string {
  // Best-effort: many plugin runtimes expose api.pluginDir; fallback to cwd.
  return api?.pluginDir || process.cwd();
}

export default function register(api: any) {
  const cfg: PluginCfg = (api.config?.plugins?.entries?.["subagent-security-python-pipe"]?.config ?? {}) as any;
  const pluginDir = resolvePluginDirFromConfig(api);

  const pythonBin = cfg.pythonBin ?? "python3";
  const workerPathTpl = cfg.workerPath ?? "{pluginDir}/worker/worker.py";
  const workerPath = workerPathTpl.replaceAll("{pluginDir}", pluginDir);

  const allowedOps = new Set((cfg.allowedOps ?? ["echo", "sha256"]).map(String));

  const worker = new PersistentPythonWorker(
    {
      pythonBin,
      workerPath: path.resolve(workerPath),
      startupTimeoutMs: cfg.startupTimeoutMs ?? 5000,
      requestTimeoutMs: cfg.requestTimeoutMs ?? 15000,
      maxOutputBytes: cfg.maxOutputBytes ?? 256 * 1024,
    },
    api.logger,
  );

  // Generic pipe tool (recommended for internal use) - keep optional.
  api.registerTool(
    {
      name: "python_pipe_call",
      description:
        "Call a whitelisted operation in a persistent local Python worker (JSONL over stdin/stdout).",
      parameters: Type.Object({
        op: Type.String({ minLength: 1 }),
        params: Type.Optional(Type.Any()),
      }),
      async execute(_id: string, params: any) {
        if (!allowedOps.has(params.op)) {
          return {
            content: [
              {
                type: "text",
                text: `Denied op: ${params.op}. Allowed ops: ${Array.from(allowedOps).join(", ")}`,
              },
            ],
          };
        }

        const result = await worker.call(params.op, params.params ?? {});
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    },
    { optional: true },
  );

  // Example rigid tools (preferred for subagents): no arbitrary op.
  api.registerTool(
    {
      name: "python_pipe_echo",
      description: "Echo text via the persistent Python worker (rigid op=echo).",
      parameters: Type.Object({ text: Type.String({ minLength: 0, maxLength: 4000 }) }),
      async execute(_id: string, params: any) {
        if (!allowedOps.has("echo")) {
          return { content: [{ type: "text", text: "Denied: op echo not allowed by plugin config." }] };
        }
        const result = await worker.call("echo", { text: params.text ?? "" });
        return { content: [{ type: "text", text: result.text ?? "" }] };
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "python_pipe_sha256",
      description: "Compute sha256(text) via the persistent Python worker (rigid op=sha256).",
      parameters: Type.Object({ text: Type.String({ minLength: 0, maxLength: 20000 }) }),
      async execute(_id: string, params: any) {
        if (!allowedOps.has("sha256")) {
          return { content: [{ type: "text", text: "Denied: op sha256 not allowed by plugin config." }] };
        }
        const result = await worker.call("sha256", { text: params.text ?? "" });
        return { content: [{ type: "text", text: result.sha256 ?? "" }] };
      },
    },
    { optional: true },
  );
}
