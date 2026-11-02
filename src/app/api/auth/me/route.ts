import { readSession } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await readSession();
  if (!s) return json({ user: null });
  return json({
    user: { ...s.user, unlimited: s.user.role === "OWNER_ADMIN" },
    csrfToken: s.csrfToken,
  });
}
