import { authedRoute, json } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";
import { cleanupWorkTemp } from "@/lib/storage";

export const POST = authedRoute(
  async () => {
    const result = await cleanupWorkTemp();
    return json({ ok: true, ...result });
  },
  { rate: RATE.write },
);
