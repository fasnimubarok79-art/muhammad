"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ClientApiError } from "@/lib/client";
import { guessPlatform } from "./ImportPanel";

const LABEL: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", direct: "File video" };

/**
 * Paste a link and press Generate: creates a project and opens it with the link already checked.
 * The rights confirmation and the import itself happen on the project page (nothing is fetched here).
 */
export function UrlBar() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const detected = guessPlatform(url);
  return (
    <form
      className="card flex flex-col gap-2 p-2 sm:flex-row sm:items-center"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim()) return;
        setBusy(true);
        setErr(null);
        try {
          sessionStorage.setItem("clipkita:pending-link", url.trim());
          const r = await api<{ project: { id: string } }>("/api/projects", { body: { title: `Impor ${new Date().toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}` } });
          router.push(`/projects/${r.project.id}`);
        } catch (e2) {
          setErr(e2 instanceof ClientApiError ? e2.body.message : "Gagal membuat proyek");
          setBusy(false);
        }
      }}
    >
      <label htmlFor="url-bar" className="sr-only">Tempel link video</label>
      <div className="relative min-w-0 flex-1">
        <input id="url-bar" className="h-12 w-full rounded-ctl bg-transparent px-3 pr-28 text-[15px] text-ink outline-none placeholder:text-faint" inputMode="url" placeholder="Tempel link YouTube, TikTok, Instagram, Facebook, atau URL video..." value={url} onChange={(e) => setUrl(e.target.value)} />
        {detected && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-surface2 px-2.5 py-1 text-[12px] font-semibold text-system">{LABEL[detected]}</span>}
      </div>
      <button className="btn-primary h-12 shrink-0 px-7" disabled={busy || !url.trim()}>{busy ? "Membuka..." : "Generate"}</button>
      <button
        type="button"
        className="btn-secondary h-12 shrink-0 px-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ project: { id: string } }>("/api/projects", { body: { title: `Unggahan ${new Date().toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}` } });
            router.push(`/projects/${r.project.id}#upload`);
          } catch {
            setErr("Gagal membuat proyek");
            setBusy(false);
          }
        }}
      >
        Unggah file
      </button>
      {err && <p role="alert" className="px-2 text-[13px] text-danger">{err}</p>}
    </form>
  );
}
