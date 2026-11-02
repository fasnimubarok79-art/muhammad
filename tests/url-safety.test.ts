import { describe, expect, it } from "vitest";
import { isPrivateIp, normalizeUrl, resolvePublic, UnsafeUrlError } from "@/lib/url-safety";

describe("normalizeUrl (SSRF layer 1)", () => {
  const blocked = [
    "http://localhost/video.mp4",
    "http://127.0.0.1/a.mp4",
    "http://2130706433/a.mp4", // decimal 127.0.0.1
    "http://0x7f.0.0.1/a.mp4",
    "http://0177.0.0.1/a.mp4", // octal
    "http://[::1]/a.mp4",
    "http://[::ffff:127.0.0.1]/a.mp4",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/x.mp4",
    "http://192.168.1.1/x.mp4",
    "http://172.16.0.1/x.mp4",
    "http://100.64.0.1/x.mp4",
    "http://0.0.0.0/x.mp4",
    "http://metadata.google.internal/",
    "http://printer.local/",
    "file:///etc/passwd",
    "gopher://example.com/",
    "ftp://example.com/a.mp4",
    "http://user:pass@example.com/a.mp4",
    "http://example.com:8080/a.mp4",
    "http://example.com:22/",
    "javascript:alert(1)",
    "http://exa mple.com/",
  ];
  for (const u of blocked) {
    it(`blocks ${u}`, () => expect(() => normalizeUrl(u)).toThrow(UnsafeUrlError));
  }
  it("accepts a normal https link and strips the fragment", () => {
    expect(normalizeUrl("https://cdn.example.com/v/clip.mp4#t=10").toString()).toBe("https://cdn.example.com/v/clip.mp4");
  });
  it("adds https to bare hosts", () => {
    expect(normalizeUrl("youtube.com/watch?v=abcdefghijk").protocol).toBe("https:");
  });
});

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.31.255.255", "192.168.0.1", "169.254.1.1", "100.100.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "ff02::1"])(
    "%s is private/reserved",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "142.250.72.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => expect(isPrivateIp(ip)).toBe(false));
  it("treats garbage as unsafe", () => expect(isPrivateIp("not-an-ip")).toBe(true));
});

describe("resolvePublic (DNS rebinding / private resolution)", () => {
  const fake = (addrs: string[]) => (async () => addrs.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }))) as never;
  it("rejects a public name that resolves to a private address", async () => {
    await expect(resolvePublic(new URL("https://evil.example.com/"), fake(["10.0.0.7"]))).rejects.toThrow(UnsafeUrlError);
  });
  it("rejects when any answer is private (mixed records)", async () => {
    await expect(resolvePublic(new URL("https://evil.example.com/"), fake(["93.184.216.34", "127.0.0.1"]))).rejects.toThrow(UnsafeUrlError);
  });
  it("returns the validated address to pin the connection to", async () => {
    const r = await resolvePublic(new URL("https://ok.example.com/"), fake(["93.184.216.34"]));
    expect(r.address).toBe("93.184.216.34");
  });
});
