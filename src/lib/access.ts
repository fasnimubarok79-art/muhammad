import { db } from "./db";
import { notFound } from "./http";

/**
 * Ownership checks (IDOR/BOLA). Every lookup filters by the caller's userId, and a resource
 * owned by someone else returns 404 exactly like a missing one.
 */
export async function ownedProject(userId: string, id: string) {
  const p = await db.project.findFirst({ where: { id, userId } });
  if (!p) throw notFound("Project");
  return p;
}

export async function ownedSource(userId: string, id: string) {
  const s = await db.sourceVideo.findFirst({ where: { id, project: { userId } } });
  if (!s) throw notFound("Source video");
  return s;
}

export async function ownedClip(userId: string, id: string) {
  const c = await db.clip.findFirst({ where: { id, project: { userId } }, include: { sourceVideo: true } });
  if (!c) throw notFound("Clip");
  return c;
}

export async function ownedJob(userId: string, id: string) {
  const j = await db.renderJob.findFirst({ where: { id, userId } });
  if (!j) throw notFound("Job");
  return j;
}
