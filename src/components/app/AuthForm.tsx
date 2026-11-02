"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { ClientApiError } from "@/lib/client";
import { Wordmark } from "./AppShell";

export type FieldDef = { name: string; label: string; type: string; autoComplete: string; hint?: string; minLength?: number };

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8"><Wordmark /></div>
        <h1 className="text-[28px] font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-6 text-[13px] text-muted">{footer}</div>}
      </div>
    </main>
  );
}

export function AuthForm({ fields, submit, onSubmit }: { fields: FieldDef[]; submit: string; onSubmit: (values: Record<string, string>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const values = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    try {
      await onSubmit(values);
    } catch (err) {
      if (err instanceof ClientApiError) {
        const issues = (err.body.issues as Array<{ message: string }> | undefined)?.map((i) => i.message).join(". ");
        setError(issues || err.body.message);
      } else setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className="flex flex-col gap-4" noValidate>
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="label">{f.label}</label>
          <input id={f.name} name={f.name} type={f.type} autoComplete={f.autoComplete} required minLength={f.minLength} className="field" aria-describedby={f.hint ? `${f.name}-hint` : undefined} />
          {f.hint && <p id={`${f.name}-hint`} className="mt-1 text-[12px] text-muted">{f.hint}</p>}
        </div>
      ))}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <button className="btn-primary mt-2 h-11" disabled={busy}>{busy ? "Please wait..." : submit}</button>
    </form>
  );
}

export const FooterLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-ink underline underline-offset-4 decoration-faint hover:decoration-ink">{children}</Link>
);
