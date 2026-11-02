"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ErrorNote, Spinner } from "@/components/ui/bits";
import { useToast } from "@/components/ui/use-toast";
import { usePoll } from "@/hooks/usePoll";
import { api } from "@/lib/client";

type Provider = { id: string; label: string; configured: boolean; requiredEnv: string[]; scopes: string[]; docs: string; directPublish: boolean; directPublishNote: string; manualPublish: string[] };
type Account = { id: string; platform: string; displayName: string | null; scopes: string | null; expiresAt: string | null; createdAt: string };

function Social() {
  const toast = useToast();
  const sp = useSearchParams();
  const { data, error, refresh } = usePoll(
    async () => {
      const [p, a] = await Promise.all([api<{ providers: Provider[] }>("/api/social/providers"), api<{ accounts: Account[] }>("/api/social/accounts")]);
      return { providers: p.providers, accounts: a.accounts };
    },
    useCallback(() => false, []),
  );
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Social accounts and Publish Studio</h1>
      <p className="mt-2 max-w-2xl text-muted">Connections use each platform&apos;s official OAuth login. ClipKita never asks for or stores your social media passwords; access tokens are stored encrypted and never sent to the browser.</p>
      {sp.get("error") && <p role="alert" className="mt-4 text-[13px] text-danger">{sp.get("error")}</p>}
      {sp.get("connected") && <p role="status" className="mt-4 text-[13px] text-system">{sp.get("connected")}</p>}
      <div className="card mt-6 border-warn/40 px-4 py-3 text-[13px]">
        <span className="font-semibold text-warn">Direct publishing is not available yet.</span>{" "}
        <span className="text-muted">Each platform requires an approved developer app before posting through its API. Until then, download the MP4 from the editor and publish it with the steps below. Nothing is reported as published unless the platform confirms it.</span>
      </div>
      {error && <div className="mt-6"><ErrorNote message={error} onRetry={refresh} /></div>}
      {!data && !error && <div className="mt-6"><Spinner /></div>}
      {data && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {data.providers.map((p) => {
            const accounts = data.accounts.filter((a) => a.platform === p.id);
            return (
              <section key={p.id} className="card p-5" aria-labelledby={`p-${p.id}`}>
                <div className="flex items-center gap-2">
                  <h2 id={`p-${p.id}`} className="text-[18px] font-bold">{p.label}</h2>
                  <span className={`ml-auto inline-flex items-center gap-1.5 text-[12px] ${accounts.length ? "text-system" : "text-muted"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${accounts.length ? "bg-system" : "bg-faint"}`} />
                    {accounts.length ? "Connected" : p.configured ? "Not connected" : "Not configured on server"}
                  </span>
                </div>
                {accounts.map((a) => (
                  <div key={a.id} className="mt-3 flex items-center gap-2 rounded-ctl bg-surface2 px-3 py-2 text-[13px]">
                    <span className="truncate">{a.displayName ?? "Linked account"}</span>
                    <span className="text-[12px] text-muted">scopes: {a.scopes}</span>
                    <button className="btn-ghost ml-auto h-7 px-2 text-[12px]" onClick={async () => { await api(`/api/social/accounts/${a.id}`, { method: "DELETE" }); toast({ tone: "success", title: `${p.label} disconnected`, body: "Also revoke access in the platform's own settings." }); void refresh(); }}>Disconnect</button>
                  </div>
                ))}
                {p.configured ? (
                  <a href={`/api/social/oauth/${p.id}/start`} className="btn-secondary mt-4">Connect {p.label}</a>
                ) : (
                  <p className="mt-3 text-[12px] text-muted">The server owner must register an app and set {p.requiredEnv.join(" and ")}.</p>
                )}
                <details className="mt-4">
                  <summary className="text-[13px] font-semibold">Publish manually</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-muted">
                    {p.manualPublish.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                  <p className="mt-2 text-[12px] text-faint">Permissions requested when connecting: {p.scopes.join(", ")}</p>
                </details>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

export default function Page() {
  return <Suspense><Social /></Suspense>;
}
