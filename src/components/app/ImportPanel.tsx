"use client";

import { useEffect, useRef, useState } from "react";
import { api, ClientApiError, fmtBytes } from "@/lib/client";
import { AccessBadge } from "../ui/bits";
import { useToast } from "../ui/use-toast";

type Access = { platform: string; accessState: string; reason: string; nextAction: string; embedUrl?: string };

const PLATFORM: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", direct: "Direct link", unknown: "Unknown" };
const SOCIAL = new Set(["youtube", "tiktok", "instagram", "facebook"]);

/** Instant, client-side guess of the platform while typing (the server decides for real). */
export function guessPlatform(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (/(^|\.|\/)(youtube\.com|youtu\.be)/.test(v)) return "youtube";
  if (/(^|\.|\/)tiktok\.com/.test(v)) return "tiktok";
  if (/(^|\.|\/)(instagram\.com|instagr\.am)/.test(v)) return "instagram";
  if (/(^|\.|\/)(facebook\.com|fb\.watch|fb\.com)/.test(v)) return "facebook";
  if (/^https?:\/\/.+\.(mp4|mov|webm|mkv)(\?|$)/.test(v)) return "direct";
  return null;
}

/** Paste Video Link + Upload. Link flow: detect -> validate -> access state -> process or explain. */
export function ImportPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [rights, setRights] = useState(false);
  const [autoCheck, setAutoCheck] = useState(false);
  const guess = guessPlatform(url);
  const [upload, setUpload] = useState<{ name: string; size: number; pct: number } | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("clipkita:pending-link");
      if (pending) {
        setUrl(pending);
        sessionStorage.removeItem("clipkita:pending-link");
        setAutoCheck(true);
      }
    } catch {}
  }, []);

  /** Step 1: detect platform and access state, show the official preview. Nothing is downloaded yet. */
  async function checkLink() {
    if (!url.trim()) return;
    setBusy(true);
    setAccess(null);
    setRights(false);
    try {
      const r = await api<{ access: Access }>("/api/video/inspect", { body: { url } });
      setAccess(r.access);
      // direct public files need no rights step; import them right away
      if (r.access.accessState === "PROCESSABLE" && !SOCIAL.has(r.access.platform)) await importLink(false);
    } catch (e) {
      toast({ tone: "error", title: "Link not checked", body: e instanceof ClientApiError ? e.body.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  // arriving from Generate: check the link straight away so the preview and rights step show up
  useEffect(() => {
    if (autoCheck && url) {
      setAutoCheck(false);
      void checkLink();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, url]);

  /** Step 2: create the source and queue download + AI analysis. */
  async function importLink(confirmed: boolean) {
    setBusy(true);
    try {
      const r = await api<{ access: Access; job: unknown }>("/api/video", { body: { projectId, url, rightsConfirmed: confirmed } });
      setAccess(r.access);
      if (r.job) {
        toast({ tone: "success", title: "Video is being fetched", body: "Download, transcription and clip detection run in the background. Progress shows on the right." });
        setUrl("");
        setAccess(null);
        setRights(false);
      }
      onChange();
    } catch (e) {
      toast({ tone: "error", title: "Link not imported", body: e instanceof ClientApiError ? e.body.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function sendFile(file: File) {
    setUploadErr(null);
    const max = 500 * 1024 * 1024;
    if (file.size > max) return setUploadErr("That file is larger than 500 MB.");
    if (!/^video\/(mp4|quicktime|webm|x-matroska)$/.test(file.type)) return setUploadErr("Upload an MP4, MOV, WebM or MKV video.");
    const csrf = (await fetch("/api/auth/me").then((r) => r.json())).csrfToken as string;
    setUpload({ name: file.name, size: file.size, pct: 0 });
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", `/api/video/upload?projectId=${projectId}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-csrf-token", csrf);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setUpload((u) => (u ? { ...u, pct: Math.round((ev.loaded / ev.total) * 100) } : u));
    xhr.onload = () => {
      xhrRef.current = null;
      setUpload(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        toast({ tone: "success", title: "Upload complete", body: "Analysis has been queued." });
        onChange();
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(xhr.responseText).error.message;
        } catch {}
        setUploadErr(msg);
      }
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setUpload(null);
      setUploadErr("Network error during upload.");
    };
    xhr.send(file);
  }

  return (
    <section aria-labelledby="import-h" className="card p-5">
      <h2 id="import-h" className="text-[18px] font-bold">Add a video</h2>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void checkLink();
        }}
      >
        <label htmlFor="vlink" className="sr-only">Paste Video Link</label>
        <div className="relative min-w-0 flex-1">
          <input id="vlink" className="field pr-28" inputMode="url" placeholder="Paste a YouTube, TikTok, Instagram or Facebook link" value={url} onChange={(e) => { setUrl(e.target.value); setAccess(null); }} maxLength={2048} />
          {guess && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold text-system">{PLATFORM[guess]}</span>}
        </div>
        <button className="btn-secondary shrink-0" disabled={busy || !url.trim()}>{busy && !access ? "Checking..." : "Check link"}</button>
      </form>

      {access && (
        <div className="mt-4 rounded-ctl border border-line bg-surface2 p-4" role="status">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{PLATFORM[access.platform] ?? access.platform}</span>
            <AccessBadge state={access.accessState} />
          </div>
          <p className="mt-2 text-[13px] text-muted">{access.reason}</p>
          {access.embedUrl && (
            <div className="mt-3 aspect-video w-full max-w-md overflow-hidden rounded-ctl bg-bg">
              <iframe src={access.embedUrl} title="Official platform preview" className="h-full w-full" allow="encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" />
            </div>
          )}
          {access.accessState === "PROCESSABLE" && SOCIAL.has(access.platform) && (
            <div className="mt-4 border-t border-line pt-4">
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#3DDC97]" checked={rights} onChange={(e) => setRights(e.target.checked)} />
                <span>I own this video or have permission from its owner to download and edit it.</span>
              </label>
              <button className="btn-primary mt-3" disabled={!rights || busy} onClick={() => importLink(true)}>
                {busy ? "Starting..." : "Import and find clips"}
              </button>
            </div>
          )}
          {access.nextAction === "upload_original" && (
            <button className="btn-primary mt-3" onClick={() => fileRef.current?.click()}>Upload the original file</button>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
          className="sr-only"
          id="vfile"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void sendFile(f);
          }}
        />
        <label htmlFor="vfile" className="btn-primary" aria-disabled={Boolean(upload)}>Upload video</label>
        <span className="text-[12px] text-muted">MP4, MOV, WebM or MKV · up to 500 MB · up to 120 minutes</span>
      </div>
      {upload && (
        <div className="mt-3" role="status">
          <div className="flex justify-between text-[12px] tc">
            <span className="truncate">{upload.name} · {fmtBytes(upload.size)}</span>
            <span>{upload.pct}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface2">
            <div className="h-full bg-system transition-[width]" style={{ width: `${upload.pct}%` }} />
          </div>
          <button className="btn-ghost mt-1 h-8 px-0" onClick={() => xhrRef.current?.abort()}>Cancel upload</button>
        </div>
      )}
      {uploadErr && <p role="alert" className="mt-3 text-[13px] text-danger">{uploadErr}</p>}
    </section>
  );
}
