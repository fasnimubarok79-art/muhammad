"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { useSession } from "./session";
import { Spinner, StatusPill } from "../ui/bits";
import {
  IconBell, IconClips, IconCollapse, IconDashboard, IconEditor, IconExpand, IconExport, IconFlame, IconFolder, IconPublish, IconSearch, IconSettings, IconShield, IconSubtitles, IconToken,
} from "../ui/icons";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/clips", label: "Galeri Klip", icon: IconClips },
  { href: "/projects", label: "Proyek", icon: IconFolder },
  { href: "/viral", label: "Klip Viral", icon: IconFlame },
  { href: "/editor", label: "AI Video Editor", icon: IconEditor },
  { href: "/subtitles", label: "Subtitle Studio", icon: IconSubtitles },
  { href: "/exports", label: "Riwayat Export", icon: IconExport },
  { href: "/social", label: "Publikasi", icon: IconPublish },
  { href: "/tokens", label: "Token", icon: IconToken },
  { href: "/settings", label: "Pengaturan", icon: IconSettings },
];

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="font-display text-[17px] font-extrabold tracking-tight" style={{ fontStretch: "118%" }} aria-label="ClipKita-Pro">
      {compact ? "c" : <>clipkita<span className="text-muted">-pro</span></>}
      <span className="text-edit">.</span>
    </Link>
  );
}

const active = (path: string, href: string) => path === href || path.startsWith(href + "/");

type Note = { id: string; kind: string; status: string; clipTitle: string | null; sourceName: string | null; updatedAt: string; progress: number };

/** Notifications = your own jobs that finished or failed, newest first. "Seen" is remembered per browser. */
function Notifications() {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>("");
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ jobs: Note[] }>("/api/jobs?limit=12");
      setItems(r.jobs);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      setSeen(localStorage.getItem("clipkita:notes-seen") ?? "");
    } catch {}
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 15000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const close = (e: MouseEvent) => open && box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const done = items.filter((j) => ["completed", "failed"].includes(j.status));
  const unread = done.filter((j) => !seen || j.updatedAt > seen).length;
  return (
    <div className="relative" ref={box}>
      <button
        className="relative grid h-9 w-9 place-items-center rounded-ctl text-muted hover:bg-surface2 hover:text-ink"
        aria-label={`Notifikasi${unread ? `, ${unread} baru` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          const now = new Date().toISOString();
          try {
            localStorage.setItem("clipkita:notes-seen", now);
          } catch {}
          setTimeout(() => setSeen(now), 1500);
        }}
      >
        <IconBell />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-edit px-1 text-[10px] font-bold text-bg tc">{unread}</span>}
      </button>
      {open && (
        <div className="card shadow-float absolute right-0 top-11 z-40 w-[min(340px,calc(100vw-32px))] p-2" role="dialog" aria-label="Notifikasi">
          <p className="px-2 py-1 text-[12px] font-semibold text-muted">Pekerjaan terbaru</p>
          {items.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">Belum ada aktivitas.</p>}
          <ul className="max-h-80 overflow-y-auto">
            {items.map((j) => (
              <li key={j.id} className="flex items-center gap-2 rounded px-2 py-2 text-[13px] hover:bg-surface2">
                <span className="min-w-0 flex-1 truncate">{j.kind === "RENDER" ? `Render · ${j.clipTitle ?? "klip"}` : `Analisis · ${j.sourceName ?? "video"}`}</span>
                <StatusPill status={j.status} progress={j.progress} />
              </li>
            ))}
          </ul>
          <Link href="/exports" className="mt-1 block rounded px-2 py-1.5 text-[12px] text-muted hover:text-ink">Lihat riwayat export</Link>
        </div>
      )}
    </div>
  );
}

function AccountMenu({ name, email, onLogout }: { name: string | null; email: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => open && box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const initial = (name ?? email).trim().charAt(0).toUpperCase();
  return (
    <div className="relative" ref={box}>
      <button className="grid h-9 w-9 place-items-center rounded-full bg-edit/15 text-[14px] font-bold text-edit ring-1 ring-edit/40" aria-label="Menu akun" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {initial}
      </button>
      {open && (
        <div className="card shadow-float absolute right-0 top-11 z-40 w-60 p-1" role="menu">
          <div className="px-3 py-2">
            <p className="truncate text-[13px] font-semibold">{name ?? "Akun"}</p>
            <p className="truncate text-[12px] text-muted">{email}</p>
          </div>
          <Link role="menuitem" href="/settings" className="block rounded px-3 py-2 text-[13px] hover:bg-surface2">Pengaturan</Link>
          <Link role="menuitem" href="/tokens" className="block rounded px-3 py-2 text-[13px] hover:bg-surface2">Token dan riwayat</Link>
          <button role="menuitem" className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-surface2" onClick={onLogout}>Keluar</button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, loading, refresh } = useSession();
  const path = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("clipkita:sidebar") === "collapsed");
    } catch {}
  }, []);
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    if (user?.mustChangePassword && path !== "/change-password") router.replace("/change-password");
  }, [loading, user, path, router]);
  if (loading || !user) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  const nav = user.role === "OWNER_ADMIN" ? [...NAV, { href: "/admin", label: "Admin", icon: IconShield }] : NAV;
  const tokens = user.unlimited ? "Tak terbatas" : `${user.tokenBalance.toLocaleString("id-ID")} token`;
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/login");
  };
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("clipkita:sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  return (
    <div className={`min-h-dvh lg:grid ${collapsed ? "lg:grid-cols-[68px_minmax(0,1fr)]" : "lg:grid-cols-[236px_minmax(0,1fr)]"}`}>
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className={`flex h-14 items-center ${collapsed ? "justify-center" : "px-5"}`}><Wordmark compact={collapsed} /></div>
        <nav aria-label="Menu utama" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-2">
          {nav.map((n) => {
            const on = active(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={collapsed ? n.label : undefined}
                aria-label={collapsed ? n.label : undefined}
                aria-current={on ? "page" : undefined}
                className={`relative flex items-center gap-3 rounded-ctl py-2 text-[14px] font-medium ${collapsed ? "justify-center px-0" : "px-3"} ${on ? "bg-surface2 text-ink" : "text-muted hover:bg-surface2/60 hover:text-ink"}`}
              >
                {on && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded bg-edit" />}
                <n.icon className={`h-5 w-5 shrink-0 ${on ? "text-edit" : ""}`} />
                {!collapsed && <span className="truncate">{n.label}</span>}
              </Link>
            );
          })}
        </nav>
        <button onClick={toggle} className={`m-2.5 flex items-center gap-3 rounded-ctl py-2 text-[13px] text-muted hover:bg-surface2 hover:text-ink ${collapsed ? "justify-center" : "px-3"}`} aria-label={collapsed ? "Buka sidebar" : "Ciutkan sidebar"}>
          {collapsed ? <IconExpand /> : <><IconCollapse /> Ciutkan</>}
        </button>
      </aside>

      <div className="min-w-0">
        {/* top header */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95">
          <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
            <div className="lg:hidden"><Wordmark /></div>
            <form
              role="search"
              className="relative hidden max-w-md flex-1 sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(`/clips${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
              }}
            >
              <label htmlFor="global-search" className="sr-only">Cari klip</label>
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input id="global-search" className="field h-9 pl-9" placeholder="Cari klip, judul atau transkrip" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/tokens" className="rounded-full border border-line px-3 py-1 text-[12px] font-semibold tc hover:border-muted" title="Saldo token">{tokens}</Link>
              <Notifications />
              <AccountMenu name={user.name} email={user.email} onLogout={logout} />
            </div>
          </div>
          {/* mobile navigation */}
          <nav aria-label="Menu utama" className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={`flex shrink-0 items-center gap-1.5 rounded-ctl px-3 py-1.5 text-[13px] ${active(path, n.href) ? "bg-surface2 text-ink" : "text-muted"}`}>
                <n.icon className="h-4 w-4" />
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className={wide ? "" : "mx-auto max-w-[1600px] px-4 py-8 lg:px-8"}>{children}</main>
      </div>
    </div>
  );
}
