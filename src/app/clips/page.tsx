"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ClipGallery } from "@/components/app/ClipGallery";
import { UrlBar } from "@/components/app/UrlBar";

function Clips() {
  const q = useSearchParams().get("q") ?? "";
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Galeri Klip</h1>
      <p className="mt-1 text-muted">Semua klip dari semua proyek Anda.</p>
      <div className="mt-6"><UrlBar /></div>
      <div className="mt-10"><ClipGallery title="Klip" initialQuery={q} /></div>
    </AppShell>
  );
}

export default function ClipsPage() {
  return <Suspense><Clips /></Suspense>;
}
