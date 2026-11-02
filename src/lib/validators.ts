import { z } from "zod";
import { PASSWORD_RULES } from "./crypto";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(PASSWORD_RULES.min, `Password must be at least ${PASSWORD_RULES.min} characters`)
  .max(PASSWORD_RULES.max);
export const idSchema = z.string().regex(/^c[a-z0-9]{20,30}$/, "Invalid id");
export const idemKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, "Invalid idempotency key");
