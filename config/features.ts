/**
 * Feature flags. A feature that is not built (or not configured) is HIDDEN, never shown as a dead
 * button or a "coming soon" label. Flip a flag only when the feature works end to end and is tested.
 */
export const FEATURES = {
  /** Generative script/title writing with an LLM provider (needs a provider; none configured). */
  aiScript: false,
  /** Posting directly to TikTok/YouTube/Instagram/Facebook through their APIs (not built). */
  directPublish: false,
  /** OAuth account linking on the Publish page (built, not tested against live platforms). */
  socialAccountLinking: false,
  /** Editor extras that are not built yet. */
  transitions: false,
  bRoll: false,
  music: false,
  watermark: false,
  qualityAudit: false,
  batchExport: false,
  export4k: false,
  /** Account extras that need external services. */
  emailVerification: false,
  googleLogin: false,
} as const;

export type Feature = keyof typeof FEATURES;
export const isEnabled = (f: Feature) => FEATURES[f];
