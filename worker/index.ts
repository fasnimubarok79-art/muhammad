import "../src/lib/env-alias";
import os from "node:os";
import { db } from "../src/lib/db";
import { env } from "../src/lib/env";
import { refund } from "../src/lib/tokens";
import { runJob } from "./pipeline";

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 1));
const POLL_MS = 1500;
const active = new Map<string, AbortController>();
let stopping = false;

/** Atomically claim the oldest queued job (safe with several workers). */
async function claim(): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "RenderJob" SET status = 'validating', "lockedAt" = now(), "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "RenderJob" WHERE status = 'queued' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Jobs whose worker died: mark failed and refund. */
async function recoverStale() {
  const cutoff = new Date(Date.now() - env().JOB_TIMEOUT_MIN * 60_000 - 5 * 60_000);
  const stale = await db.renderJob.findMany({
    where: { status: { in: ["validating", "downloading", "analyzing", "transcribing", "editing", "rendering"] }, lockedAt: { lt: cutoff } },
  });
  for (const j of stale) {
    await db.renderJob.update({ where: { id: j.id }, data: { status: "failed", error: "Worker stopped while processing", finishedAt: new Date() } });
    if (j.kind === "RENDER") await refund(j.userId, j.id, "worker stopped");
  }
  if (stale.length) console.log(`[worker] recovered ${stale.length} stale job(s)`);
}

/** Abort running jobs that a user cancelled. */
async function watchCancellations() {
  if (!active.size) return;
  const ids = Array.from(active.keys());
  const cancelled = await db.renderJob.findMany({ where: { id: { in: ids }, status: "cancelled" }, select: { id: true } });
  cancelled.forEach((c) => active.get(c.id)?.abort());
}

async function heartbeat() {
  await db.workerHeartbeat.upsert({
    where: { id: WORKER_ID },
    create: { id: WORKER_ID, seenAt: new Date(), info: { concurrency: CONCURRENCY, active: active.size } },
    update: { seenAt: new Date(), info: { concurrency: CONCURRENCY, active: active.size } },
  });
}

async function tick() {
  while (!stopping && active.size < CONCURRENCY) {
    const id = await claim();
    if (!id) break;
    const job = await db.renderJob.findUniqueOrThrow({ where: { id } });
    const ac = new AbortController();
    active.set(id, ac);
    console.log(`[worker] start ${job.kind} ${id}`);
    runJob(job, ac.signal)
      .catch((e) => console.error("[worker] runner crashed", e))
      .finally(async () => {
        active.delete(id);
        const done = await db.renderJob.findUnique({ where: { id }, select: { status: true, error: true } });
        console.log(`[worker] end ${id} -> ${done?.status}${done?.error ? ` (${done.error})` : ""}`);
      });
  }
}

async function main() {
  env(); // fail fast on bad configuration
  console.log(`[worker] ${WORKER_ID} concurrency=${CONCURRENCY}`);
  // wait for the database instead of crashing (it may start after the worker)
  for (let attempt = 1; !stopping; attempt++) {
    try {
      await recoverStale();
      break;
    } catch (e) {
      if (attempt === 1 || attempt % 10 === 0) console.error("[worker] database not reachable yet, retrying:", e instanceof Error ? e.message.split("\n")[0] : e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  let n = 0;
  while (!stopping) {
    try {
      await tick();
      await watchCancellations();
      if (n++ % 10 === 0) await heartbeat();
      if (n % 200 === 0) await recoverStale();
    } catch (e) {
      console.error("[worker] loop error", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    active.forEach((ac) => ac.abort());
    setTimeout(() => process.exit(0), 3000);
  });
}

if (process.env.WORKER_ONCE === "1") {
  // test helper: process the queue until empty, then exit
  (async () => {
    env();
    for (;;) {
      await tick();
      while (active.size) await new Promise((r) => setTimeout(r, 300));
      const left = await db.renderJob.count({ where: { status: "queued" } });
      if (!left) break;
    }
    await db.$disconnect();
  })();
} else {
  void main();
}
