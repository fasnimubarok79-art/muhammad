import { destroySession } from "@/lib/auth";
import { authedRoute, json } from "@/lib/http";

export const POST = authedRoute(
  async () => {
    await destroySession();
    return json({ ok: true });
  },
  { allowPasswordChange: true },
);
