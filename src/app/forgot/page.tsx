"use client";

import { useState } from "react";
import { AuthCard, AuthForm, FooterLink } from "@/components/app/AuthForm";
import { api } from "@/lib/client";

export default function Page() {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <AuthCard title="Reset your password" subtitle="We will email a link that works for 30 minutes." footer={<FooterLink href="/login">Back to log in</FooterLink>}>
      {sent ? (
        <p role="status" className="card px-4 py-3 text-[14px]">{sent}</p>
      ) : (
        <AuthForm
          submit="Send reset link"
          fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
          onSubmit={async (v) => {
            const r = await api<{ message: string }>("/api/auth/forgot", { body: v });
            setSent(r.message);
          }}
        />
      )}
    </AuthCard>
  );
}
