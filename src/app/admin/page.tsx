"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { useSession } from "@/components/app/session";
import { ErrorNote, Spinner } from "@/components/ui/bits";
import { useToast } from "@/components/ui/use-toast";
import { usePoll } from "@/hooks/usePoll";
import { api, ClientApiError } from "@/lib/client";

type U = { id: string; email: string; name: string | null; role: string; tokenBalance: number; disabledAt: string | null; createdAt: string; _count: { projects: number } };

export default function Admin() {
  const { user } = useSession();
  const toast = useToast();
  const [q, setQ] = useState("");
  const { data, error, refresh } = usePoll(() => api<{ users: U[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`), useCallback(() => false, []));
  const act = async (id: string, body: Record<string, unknown>, ok: string) => {
    try {
      await api(`/api/admin/users/${id}`, { body });
      toast({ tone: "success", title: ok });
      void refresh();
    } catch (e) {
      toast({ tone: "error", title: "Not done", body: e instanceof ClientApiError ? e.body.message : undefined });
    }
  };
  if (user && user.role !== "OWNER_ADMIN") return <AppShell><ErrorNote message="This page is for the owner admin only." /></AppShell>;
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Admin</h1>
      <p className="mt-2 text-muted">Owner accounts cannot be changed here, and no action in this app grants admin rights.</p>
      <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); void refresh(); }}>
        <label htmlFor="aq" className="sr-only">Search by email</label>
        <input id="aq" className="field max-w-xs" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-secondary">Search</button>
      </form>
      {error && <div className="mt-6"><ErrorNote message={error} onRetry={refresh} /></div>}
      {!data && !error && <div className="mt-6"><Spinner /></div>}
      {data && (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="text-left text-[12px] text-muted">
              <tr><th className="px-4 py-2 font-medium">Email</th><th className="px-4 py-2 font-medium">Role</th><th className="px-4 py-2 text-right font-medium">Tokens</th><th className="px-4 py-2 text-right font-medium">Projects</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2 text-muted">{u.role === "OWNER_ADMIN" ? "Owner admin" : "User"}</td>
                  <td className="px-4 py-2 text-right tc">{u.role === "OWNER_ADMIN" ? "Unlimited" : u.tokenBalance}</td>
                  <td className="px-4 py-2 text-right tc">{u._count.projects}</td>
                  <td className={`px-4 py-2 ${u.disabledAt ? "text-danger" : "text-muted"}`}>{u.disabledAt ? "Disabled" : "Active"}</td>
                  <td className="px-4 py-2 text-right">
                    {u.role !== "OWNER_ADMIN" && (
                      <span className="flex justify-end gap-1">
                        <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => { const v = prompt("Token change (e.g. 100 or -50)"); const r = v ? prompt("Reason") : null; if (v && r) void act(u.id, { action: "adjust_tokens", amount: Number(v), reason: r }, "Balance adjusted"); }}>Adjust tokens</button>
                        <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => act(u.id, { action: u.disabledAt ? "enable" : "disable" }, u.disabledAt ? "Account enabled" : "Account disabled and signed out")}>{u.disabledAt ? "Enable" : "Disable"}</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
