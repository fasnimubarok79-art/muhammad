import { describe, expect, it } from "vitest";
import { inspectLink, type ConnectorDeps } from "@/lib/connectors";

const probe = (status: number, type: string): ConnectorDeps["probe"] => async (u) => ({ status, contentType: type, finalUrl: u.toString(), length: 1000 });
const deps = (p = probe(200, "video/mp4")): ConnectorDeps => ({ probe: p });

describe("universal link connectors", () => {
  it("YouTube watch, short and youtu.be links are PREVIEW_ONLY with an embed", async () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ"]) {
      const r = await inspectLink(u, deps());
      expect(r.platform).toBe("youtube");
      expect(r.accessState).toBe("PREVIEW_ONLY");
      expect(r.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
      expect(r.nextAction).toBe("upload_original");
    }
  });
  it("YouTube link without an id is UNSUPPORTED", async () => {
    expect((await inspectLink("https://www.youtube.com/feed/trending", deps())).accessState).toBe("UNSUPPORTED");
  });
  it("TikTok video link is PREVIEW_ONLY", async () => {
    const r = await inspectLink("https://www.tiktok.com/@someone/video/7234567890123456789", deps());
    expect(r.accessState).toBe("PREVIEW_ONLY");
    expect(r.embedUrl).toContain("7234567890123456789");
  });
  it("Instagram and Facebook need authorization when no Meta token is configured", async () => {
    expect((await inspectLink("https://www.instagram.com/reel/Cabc123/", deps())).accessState).toBe("AUTHORIZATION_REQUIRED");
    expect((await inspectLink("https://fb.watch/abc123/", deps())).accessState).toBe("AUTHORIZATION_REQUIRED");
  });
  it("public direct video file is PROCESSABLE", async () => {
    const r = await inspectLink("https://cdn.example.com/talk.mp4", deps());
    expect(r.accessState).toBe("PROCESSABLE");
    expect(r.nextAction).toBe("process");
  });
  it("HTML page is UNSUPPORTED, login-protected file is AUTHORIZATION_REQUIRED", async () => {
    expect((await inspectLink("https://example.com/page", deps(probe(200, "text/html")))).accessState).toBe("UNSUPPORTED");
    expect((await inspectLink("https://example.com/private.mp4", deps(probe(403, "text/html")))).accessState).toBe("AUTHORIZATION_REQUIRED");
  });
  it("private targets never reach the probe", async () => {
    let called = false;
    const r = await inspectLink("http://169.254.169.254/latest", { probe: async () => { called = true; return { status: 200, contentType: "video/mp4", finalUrl: "" }; } });
    expect(r.accessState).toBe("UNSUPPORTED");
    expect(called).toBe(false);
  });
});

describe("link import enabled (yt-dlp)", () => {
  const on: ConnectorDeps = { probe: probe(200, "video/mp4"), linkImport: true };
  it("public social links become PROCESSABLE and keep the official preview", async () => {
    const yt = await inspectLink("https://youtu.be/dQw4w9WgXcQ", on);
    expect(yt.accessState).toBe("PROCESSABLE");
    expect(yt.nextAction).toBe("process");
    expect(yt.embedUrl).toContain("youtube-nocookie.com");
    expect((await inspectLink("https://www.tiktok.com/@a/video/7234567890123456789", on)).accessState).toBe("PROCESSABLE");
    expect((await inspectLink("https://vm.tiktok.com/ZMabc123/", on)).accessState).toBe("PROCESSABLE");
    expect((await inspectLink("https://www.instagram.com/reel/Cabc123/", on)).accessState).toBe("PROCESSABLE");
    expect((await inspectLink("https://www.facebook.com/watch/?v=123", on)).accessState).toBe("PROCESSABLE");
  });
  it("still blocks private targets and links without a video id", async () => {
    expect((await inspectLink("http://127.0.0.1/x.mp4", on)).accessState).toBe("UNSUPPORTED");
    expect((await inspectLink("https://www.youtube.com/feed/trending", on)).accessState).toBe("UNSUPPORTED");
  });
});
