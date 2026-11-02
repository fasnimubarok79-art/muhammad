import { authedRoute, json } from "@/lib/http";
import { systemHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async () => json({ checks: await systemHealth() }));
