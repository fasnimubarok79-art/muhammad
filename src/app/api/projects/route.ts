import { z } from "zod";
import { db } from "@/lib/db";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";

export const GET = authedRoute(async ({ user }) => {
  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { sourceVideos: true, clips: true } } },
  });
  return json({ projects });
});

const Body = z.object({ title: z.string().trim().min(1).max(120) });

export const POST = authedRoute(
  async ({ req, user }) => {
    const { title } = await parseJson(req, Body);
    const project = await db.project.create({ data: { userId: user.id, title } });
    return json({ project }, 201);
  },
  { rate: RATE.write },
);
