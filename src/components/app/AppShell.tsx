"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/lib/client";
import { useSession } from "./session";
import { Spinner } from "../ui/bits";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/social", label: "Publish" },
  { href: "/tokens", label: "Tokens" },
];

export function Wordmark() {
  return (
    <Link href="/" className="font-display text-[17px] font-extrabold tracking-tight" style={{ fontStretch: "118%" }}>
      clipkita<span className="text-edit">.</span>
    </Link>
  );
}

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
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-[2px]">
        <div className={`mx-auto flex h-14 items-center gap-6 px-4 ${wide ? "" : "max-w-6xl"}`}>
          <Wordmark />
          <nav aria-label="Main" className="hidden gap-1 sm:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined} className={`rounded-ctl px-3 py-1.5 text-[13px] font-medium ${path.startsWith(n.href) ? "bg-surface2 text-ink" : "text-muted hover:text-ink"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/tokens" className="rounded-full border border-line px-3 py-1 text-[12px] font-semibold tc" title="Token balance">
              {user.unlimited ? "Unlimited tokens" : `${user.tokenBalance.toLocaleString("id-ID")} tokens`}
            </Link>
            <button
              className="btn-ghost"
              onClick={async () => {
                await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
                await refresh();
                router.replace("/login");
              }}
            >
              Log out
            </button>
          </div>
        </div>
        <nav aria-label="Main mobile" className="flex gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`shrink-0 rounded-ctl px-3 py-1.5 text-[13px] ${path.startsWith(n.href) ? "bg-surface2" : "text-muted"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className={wide ? "" : "mx-auto max-w-6xl px-4 py-8"}>{children}</main>
    </div>
  );
}
