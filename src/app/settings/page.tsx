"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useSession } from "@/components/app/session";
import { useToast } from "@/components/ui/use-toast";
import { usePoll } from "@/hooks/usePoll";
import { api, ClientApiError } from "@/lib/client";

type S = { current: boolean; createdAt: string; expiresAt: string; device: string | null };

export default function Settings() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(user?.name ?? ""), [user?.name]);
  const sessions = usePoll(() => api<{ sessions: S[] }>("/api/auth/sessions"), useCallback(() => false, []));
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Pengaturan</h1>
      <div className="mt-6 grid max-w-3xl gap-6 [&>*]:min-w-0">
        <section className="card p-5" aria-labelledby="prof-h">
          <h2 id="prof-h" className="text-[18px] font-bold">Profil</h2>
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/api/me", { method: "PATCH", body: { name } });
                await refresh();
                toast({ tone: "success", title: "Profil disimpan" });
              } catch (err) {
                toast({ tone: "error", title: "Tidak tersimpan", body: err instanceof ClientApiError ? err.body.message : undefined });
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex-1">
              <label htmlFor="s-name" className="label">Nama tampilan</label>
              <input id="s-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </div>
            <button className="btn-primary" disabled={busy || !name.trim()}>Simpan</button>
          </form>
          <p className="mt-3 text-[13px] text-muted">Email: {user?.email} · Peran: {user?.role === "OWNER_ADMIN" ? "Owner Admin (token tak terbatas)" : "Pengguna"}</p>
        </section>

        <section className="card p-5" aria-labelledby="sec-h">
          <h2 id="sec-h" className="text-[18px] font-bold">Keamanan</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/change-password" className="btn-secondary">Ganti password</Link>
            <button
              className="btn-secondary"
              onClick={async () => {
                const r = await api<{ signedOut: number }>("/api/auth/sessions", { method: "DELETE" }).catch(() => null);
                toast({ tone: r ? "success" : "error", title: r ? `${r.signedOut} perangkat lain dikeluarkan` : "Gagal" });
                void sessions.refresh();
              }}
            >
              Keluarkan perangkat lain
            </button>
          </div>
          <h3 className="mt-5 font-sans text-[13px] font-semibold text-muted" style={{ fontStretch: "100%" }}>Sesi aktif</h3>
          <ul className="mt-2 divide-y divide-line text-[13px]">
            {sessions.data?.sessions.map((s, i) => (
              <li key={i} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-muted">{s.device ?? "Perangkat tidak dikenal"}</span>
                {s.current && <span className="rounded-full bg-system/15 px-2 py-0.5 text-[11px] font-semibold text-system">Perangkat ini</span>}
                <span className="text-faint tc">{new Date(s.createdAt).toLocaleDateString("id-ID")}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5" aria-labelledby="ai-h">
          <h2 id="ai-h" className="text-[18px] font-bold">AI dan layanan</h2>
          <p className="mt-2 text-[13px] text-muted">Status Whisper, FFmpeg, worker dan database ada di Dashboard → Service status. Model, bahasa transkripsi dan batas ukuran diatur di file <code>.env</code> server (lihat README).</p>
          <p className="mt-2 text-[13px] text-warn">Penyedia LLM untuk judul/skrip generatif: NEED CONFIGURATION (belum ada).</p>
        </section>
      </div>
    </AppShell>
  );
}
