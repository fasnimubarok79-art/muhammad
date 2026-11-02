"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, AuthForm, FooterLink } from "@/components/app/AuthForm";
import { api } from "@/lib/client";

function Reset() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  return (
    <AuthCard title="Choose a new password" footer={<FooterLink href="/login">Back to log in</FooterLink>}>
      <AuthForm
        submit="Save new password"
        fields={[{ name: "newPassword", label: "New password", type: "password", autoComplete: "new-password", minLength: 10, hint: "At least 10 characters. Other sessions will be signed out." }]}
        onSubmit={async (v) => {
          await api("/api/auth/reset", { body: { token, newPassword: v.newPassword } });
          router.replace("/login");
        }}
      />
    </AuthCard>
  );
}

export default function Page() {
  return <Suspense><Reset /></Suspense>;
}
