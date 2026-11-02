"use client";

import { useCallback } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Empty, ErrorNote, Spinner } from "@/components/ui/bits";
import { usePoll } from "@/hooks/usePoll";
import { api } from "@/lib/client";

type Tx = { id: string; type: string; amount: number; balanceAfter: number; reason: string; createdAt: string };
type Data = { balance: number; unlimited: boolean; prices: Record<string, number>; transactions: Tx[] };

const TYPE: Record<string, string> = { GRANT: "Grant", RESERVE: "Charged", CAPTURE: "Confirmed", REFUND: "Refund", CHARGE: "Charged", ADJUST: "Adjustment" };

export default function Tokens() {
  const { data, error, refresh } = usePoll(() => api<Data>("/api/tokens"), useCallback(() => false, []));
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Tokens</h1>
      {error && <div className="mt-6"><ErrorNote message={error} onRetry={refresh} /></div>}
      {!data && !error && <div className="mt-6"><Spinner /></div>}
      {data && (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_2fr]">
            <div className="card p-5">
              <p className="text-[13px] text-muted">Balance</p>
              <p className="mt-1 font-display text-[40px] font-extrabold tc">{data.unlimited ? "Unlimited" : data.balance.toLocaleString("id-ID")}</p>
              {data.unlimited && <p className="text-[12px] text-muted">Owner admin accounts are never charged.</p>}
            </div>
            <div className="card p-5 text-[13px]">
              <p className="font-semibold">Prices</p>
              <ul className="mt-2 grid gap-1 text-muted tc sm:grid-cols-2">
                <li>Render (450p / 720p): {data.prices.EDIT_JOB}</li>
                <li>Render 1080p: {data.prices.EDIT_JOB} + {data.prices.EXPORT_1080}</li>
                <li>Download, once per file: {data.prices.DOWNLOAD}</li>
                <li>Previews, gallery, analysis: 0</li>
              </ul>
            </div>
          </div>
          <h2 className="mt-10 text-[20px] font-bold">History</h2>
          {data.transactions.length === 0 ? (
            <div className="mt-4"><Empty title="No transactions yet" /></div>
          ) : (
            <div className="card mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="text-left text-[12px] text-muted">
                  <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Reason</th><th className="px-4 py-2 text-right font-medium">Change</th><th className="px-4 py-2 text-right font-medium">Balance</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-2 text-muted tc">{new Date(t.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className="px-4 py-2">{TYPE[t.type] ?? t.type}</td>
                      <td className="px-4 py-2 text-muted">{t.reason}</td>
                      <td className={`px-4 py-2 text-right font-semibold tc ${t.amount > 0 ? "text-system" : t.amount < 0 ? "text-ink" : "text-muted"}`}>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
                      <td className="px-4 py-2 text-right tc">{t.balanceAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
