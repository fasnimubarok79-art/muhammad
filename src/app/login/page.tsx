"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, AuthForm, FooterLink } from "@/components/app/AuthForm";
import { useSession } from "@/components/app/session";
import { api, setCsrf } from "@/lib/client";

function Login() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const { refresh } = useSession();
  return (
    <AuthCard title="Log in" subtitle="Pick up where your last cut ended." footer={<>No account yet? <FooterLink href="/register">Create one</FooterLink> · <FooterLink href="/forgot">Forgot password</FooterLink></>}>
      <AuthForm
        submit="Log in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
        onSubmit={async (v) => {
          const r = await api<{ csrfToken: string; mustChangePassword: boolean }>("/api/auth/login", { body: v });
          setCsrf(r.csrfToken);
          await refresh();
          router.replace(r.mustChangePassword ? "/change-password" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
        }}
      />
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
