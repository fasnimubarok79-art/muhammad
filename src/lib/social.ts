/**
 * Official OAuth 2.0 endpoints per platform (from each platform's developer documentation).
 * Credentials come from environment variables; nothing works until the owner registers an app
 * with the platform and passes its review. Direct publishing is NOT implemented: the platforms'
 * upload APIs need app review and real credentials that this project does not have yet.
 */
import "./env-alias";
export type Provider = {
  id: "youtube" | "tiktok" | "instagram" | "facebook";
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  clientIdParam: string; // TikTok calls it client_key
  scopeSeparator: string;
  docs: string;
  manualPublish: string[];
};

export const PROVIDERS: Provider[] = [
  {
    id: "youtube",
    label: "YouTube",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
    clientIdEnv: "YOUTUBE_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
    clientIdParam: "client_id",
    scopeSeparator: " ",
    docs: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
    manualPublish: ["Open YouTube Studio and choose Create, then Upload videos.", "Select the downloaded MP4. A 9:16 video under 3 minutes is published as a Short.", "Paste the title, description and hashtags from Publish Studio."],
  },
  {
    id: "tiktok",
    label: "TikTok",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.upload"],
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    clientIdParam: "client_key",
    scopeSeparator: ",",
    docs: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    manualPublish: ["Open TikTok and tap +, then Upload.", "Choose the downloaded MP4.", "Paste the caption and hashtags from Publish Studio."],
  },
  {
    id: "instagram",
    label: "Instagram",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list"],
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    clientIdParam: "client_id",
    scopeSeparator: ",",
    docs: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    manualPublish: ["Open Instagram and tap +, then Reel.", "Choose the downloaded MP4.", "Paste the caption and hashtags from Publish Studio."],
  },
  {
    id: "facebook",
    label: "Facebook",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    clientIdParam: "client_id",
    scopeSeparator: ",",
    docs: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
    manualPublish: ["Open your Facebook Page and choose Reel.", "Upload the downloaded MP4.", "Paste the caption and hashtags from Publish Studio."],
  },
];

export const provider = (id: string) => PROVIDERS.find((p) => p.id === id);

export function providerStatus(p: Provider) {
  const configured = Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
  return {
    id: p.id,
    label: p.label,
    configured,
    requiredEnv: [p.clientIdEnv, p.clientSecretEnv],
    scopes: p.scopes,
    docs: p.docs,
    manualPublish: p.manualPublish,
  };
}
