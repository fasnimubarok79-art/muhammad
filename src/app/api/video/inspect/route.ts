import { z } from "zod";
import { defaultProbe, inspectLink } from "@/lib/connectors";
import { env } from "@/lib/env";
import { authedRoute, json, parseJson } from "@/lib/http";
import { RATE } from "@/lib/rate-limit";

const Body = z.object({ url: z.string().min(4).max(2048) });

/** Detect platform and access state without creating anything. */
export const POST = authedRoute(
  async ({ req }) => {
    const { url } = await parseJson(req, Body);
    return json({ access: await inspectLink(url, { probe: defaultProbe, metaAppToken: env().META_APP_TOKEN, linkImport: env().LINK_IMPORT === "1" }) });
  },
  { rate: RATE.import, rateKey: "inspect" },
);
