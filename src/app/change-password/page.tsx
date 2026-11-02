"use client";

import { useRouter } from "next/navigation";
import { AuthCard, AuthForm } from "@/components/app/AuthForm";
import { useSession } from "@/components/app/session";
import { api } from "@/lib/client";

export default function Page() {
  const router = useRouter();
  const { user, refresh } = useSession();
  return (
    <AuthCard title="Change your password" subtitle={user?.mustChangePassword ? "This account still uses its initial password. Set your own before continuing." : "Other devices will be signed out."}>
      <AuthForm
        submit="Save password"
        fields={[
          { name: "currentPassword", label: "Current password", type: "password", autoComplete: "current-password" },
          { name: "newPassword", label: "New password", type: "password", autoComplete: "new-password", minLength: 10, hint: "At least 10 characters." },
        ]}
        onSubmit={async (v) => {
          await api("/api/auth/change-password", { body: v });
          await refresh();
          router.replace("/dashboard");
        }}
      />
    </AuthCard>
  );
}
