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

type RunOptions = {
  timeoutMs?: number;
  maxStdout?: number;
  maxStderr?: number;
  onStderr?: (line: string) => void;
  signal?: AbortSignal;
};

/**
 * Run a binary with an argument array (never a shell string), a hard timeout and bounded output.
 * Resolves with stdout and stderr. stderr is kept in full up to maxStderr for report parsers
 * (ffmpeg writes its measurements there), while errors expose only a short tail.
 */
export function runCapture(bin: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const maxStdout = opts.maxStdout ?? 64 * 1024 * 1024;
  const maxStderr = opts.maxStderr ?? 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...process.env, LC_ALL: "C.UTF-8" } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
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
      errLen += b.length;
      if (errLen <= maxStderr) err.push(b);
      if (opts.onStderr) {
        partial += b.toString("utf8");
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
      if (code === 0) {
        return resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
      }
      const stderr = Buffer.concat(err).toString("utf8");
      const why = signal ? `killed (${signal})` : `exit ${code}`;
      reject(new ProcessError(`${bin} failed: ${why}`, code, stderr.slice(-4000)));
    });
  });
}

/** stdout only, for callers that do not need ffmpeg's stderr. */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return runCapture(bin, args, opts).then((r) => r.stdout);
}
