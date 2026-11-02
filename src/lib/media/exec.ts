import { spawn } from "node:child_process";

export class ProcessError extends Error {
  constructor(
    message: string,
    public code: number | null,
    public stderrTail: string,
  ) {
    super(message);
  }
}

/**
 * Run a binary with an argument array (never a shell string), a hard timeout and bounded output.
 * stdout is returned; stderr is kept only as a short tail for error messages.
 */
export function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxStdout?: number; onStderr?: (line: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const maxStdout = opts.maxStdout ?? 64 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...process.env, LC_ALL: "C.UTF-8" } });
    const out: Buffer[] = [];
    let outLen = 0;
    let errTail = "";
    let partial = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (b: Buffer) => {
      outLen += b.length;
      if (outLen > maxStdout) {
        child.kill("SIGKILL");
        return;
      }
      out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString("utf8");
      errTail = (errTail + s).slice(-4000);
      if (opts.onStderr) {
        partial += s;
        const lines = partial.split(/\r|\n/);
        partial = lines.pop() ?? "";
        lines.forEach((l) => l && opts.onStderr!(l));
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ProcessError(`${bin} could not start: ${e.message}`, null, ""));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (code === 0) return resolve(Buffer.concat(out).toString("utf8"));
      const why = signal ? `killed (${signal})` : `exit ${code}`;
      reject(new ProcessError(`${bin} failed: ${why}`, code, errTail));
    });
  });
}
