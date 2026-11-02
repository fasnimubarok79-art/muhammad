import { authedRoute, json } from "@/lib/http";
import { PROVIDERS, providerStatus } from "@/lib/social";

export const GET = authedRoute(async () => json({ providers: PROVIDERS.map(providerStatus) }));
