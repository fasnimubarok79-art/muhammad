import type { Prisma } from "@prisma/client";
import { db } from "./db";

export const ACTIVE_STATES = ["queued", "validating", "downloading", "analyzing", "transcribing", "editing", "rendering"] as const;

export async function enqueueAnalyze(userId: string, projectId: string, sourceVideoId: string, tx: Prisma.TransactionClient = db) {
  const running = await tx.renderJob.findFirst({ where: { sourceVideoId, kind: "ANALYZE", status: { in: [...ACTIVE_STATES] } } });
  if (running) return running;
  return tx.renderJob.create({ data: { userId, projectId, sourceVideoId, kind: "ANALYZE" } });
}

/** Public shape of a job: never includes storage paths. */
export function publicJob(j: { id: string; kind: string; status: string; progress: number; error: string | null; createdAt: Date; finishedAt: Date | null; tokenCost: number; clipId: string | null; sourceVideoId: string | null; projectId: string; outputKey: string | null; outputMeta: Prisma.JsonValue; params: Prisma.JsonValue }) {
  const { outputKey, ...rest } = j;
  return { ...rest, hasOutput: Boolean(outputKey) };
}
