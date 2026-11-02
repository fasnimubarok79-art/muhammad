import { env } from "./env";

/**
 * Sends the password-reset email. No SMTP provider is configured in this project yet, so
 * without SMTP_URL the link is written to the server log only in development and the
 * request still answers generically. Production must configure a mail provider.
 */
export async function sendResetEmail(to: string, link: string) {
  if (!env().SMTP_URL) {
    if (process.env.NODE_ENV !== "production") console.log(`[mailer:dev] reset link for ${to}: ${link}`);
    else console.error("[mailer] SMTP_URL is not configured; reset email not sent");
    return false;
  }
  // Provider integration goes here (e.g. nodemailer with SMTP_URL). Not implemented: no provider chosen.
  console.error("[mailer] SMTP_URL is set but no mail transport is implemented yet");
  return false;
}
