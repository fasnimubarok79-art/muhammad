"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/lib/client";
import { useSession } from "./session";
import { Spinner } from "../ui/bits";

const NAV = [
  { href: "/dashboard", label: "Ringkasan" },
  { href: "/clips", label: "Galeri klip" },
  { href: "/viral", label: "Klip viral" },
  { href: "/projects", label: "Proyek" },
  { href: "/social", label: "Publikasi" },
  { href: "/tokens", label: "Token" },
];

export function Wordmark() {
  return (
    <Link href="/" className="font-display text-[17px] font-extrabold tracking-tight" style={{ fontStretch: "118%" }}>
      clipkita<span className="text-edit">.</span>
    </Link>
  );
}

const active = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, loading, refresh } = useSession();
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    if (user?.mustChangePassword && path !== "/change-password") router.replace("/change-password");
  }, [loading, user, path, router]);
  if (loading || !user) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  const nav = user.role === "OWNER_ADMIN" ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;
  const tokens = user.unlimited ? "Token tak terbatas" : `${user.tokenBalance.toLocaleString("id-ID")} token`;
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    await refresh();
    router.replace("/login");
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 pb-6 pt-5"><Wordmark /></div>
        <nav aria-label="Menu utama" className="flex flex-col gap-0.5 px-3">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(path, n.href) ? "page" : undefined}
              className={`relative rounded-ctl px-3 py-2 text-[14px] font-medium ${active(path, n.href) ? "bg-surface2 text-ink" : "text-muted hover:bg-surface2/60 hover:text-ink"}`}
            >
              {active(path, n.href) && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded bg-edit" />}
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-line p-4">
          <p className="truncate text-[13px] font-medium">{user.name ?? user.email}</p>
          <Link href="/tokens" className="mt-1 block text-[12px] text-muted tc hover:text-ink">{tokens}</Link>
          <button className="btn-ghost mt-2 h-8 px-0 text-[13px]" onClick={logout}>Keluar</button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* mobile header */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 lg:hidden">
          <div className="flex h-14 items-center gap-3 px-4">
            <Wordmark />
            <Link href="/tokens" className="ml-auto rounded-full border border-line px-3 py-1 text-[12px] font-semibold tc">{tokens}</Link>
            <button className="btn-ghost h-8 px-2" onClick={logout}>Keluar</button>
          </div>
          <nav aria-label="Menu utama" className="flex gap-1 overflow-x-auto px-4 pb-2">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={`shrink-0 rounded-ctl px-3 py-1.5 text-[13px] ${active(path, n.href) ? "bg-surface2 text-ink" : "text-muted"}`}>{n.label}</Link>
            ))}
          </nav>
        </header>
        <main className={wide ? "" : "mx-auto max-w-7xl px-4 py-8 lg:px-8"}>{children}</main>
      </div>
    </div>
  );
}
