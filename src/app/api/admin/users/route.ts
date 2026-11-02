import { db } from "@/lib/db";
import { authedRoute, json } from "@/lib/http";

export const GET = authedRoute(
  async ({ req }) => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const users = await db.user.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, email: true, name: true, role: true, tokenBalance: true, disabledAt: true, createdAt: true, _count: { select: { projects: true } } },
    });
    return json({ users });
  },
  { ownerOnly: true },
);
