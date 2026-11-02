"use client";

import { useRouter } from "next/navigation";
import { AuthCard, AuthForm, FooterLink } from "@/components/app/AuthForm";
import { useSession } from "@/components/app/session";
import { api, setCsrf } from "@/lib/client";

export default function Page() {
  const router = useRouter();
  const { refresh } = useSession();
  return (
    <AuthCard title="Create your account" subtitle="New accounts start with 500 tokens: enough for a 720p render and its download several times over." footer={<>Already registered? <FooterLink href="/login">Log in</FooterLink></>}>
      <AuthForm
        submit="Create account"
        fields={[
          { name: "name", label: "Name", type: "text", autoComplete: "name" },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", minLength: 10, hint: "At least 10 characters." },
        ]}
        onSubmit={async (v) => {
          const r = await api<{ csrfToken: string }>("/api/auth/register", { body: { ...v, name: v.name || undefined } });
          setCsrf(r.csrfToken);
          await refresh();
          router.replace("/dashboard");
        }}
      />
    </AuthCard>
  );
}
