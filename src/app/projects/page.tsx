"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Empty, ErrorNote, Spinner } from "@/components/ui/bits";
import { usePoll } from "@/hooks/usePoll";
import { api, ClientApiError } from "@/lib/client";

type Project = { id: string; title: string; updatedAt: string; _count: { sourceVideos: number; clips: number } };

export default function Projects() {
  const router = useRouter();
  const { data, error, refresh } = usePoll(() => api<{ projects: Project[] }>("/api/projects"), useCallback(() => false, []));
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoStarted = useRef(false);

  // Coming from the landing page with a link: create a project and open it with the link filled in.
  useEffect(() => {
    if (autoStarted.current) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem("clipkita:pending-link");
    } catch {}
    if (!pending) return;
    autoStarted.current = true;
    api<{ project: { id: string } }>("/api/projects", { body: { title: `Import ${new Date().toLocaleDateString("id-ID")}` } })
      .then((r) => router.push(`/projects/${r.project.id}`))
      .catch(() => setErr("Could not create a project for your link. Create one below."));
  }, [router]);
  return (
    <AppShell>
      <h1 className="text-[28px] font-extrabold">Projects</h1>
      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await api<{ project: { id: string } }>("/api/projects", { body: { title: title.trim() || "Untitled project" } });
            router.push(`/projects/${r.project.id}`);
          } catch (e2) {
            setErr(e2 instanceof ClientApiError ? e2.body.message : "Could not create the project");
            setBusy(false);
          }
        }}
      >
        <label htmlFor="ptitle" className="sr-only">Project name</label>
        <input id="ptitle" className="field sm:max-w-sm" placeholder="Project name, e.g. Podcast episode 12" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <button className="btn-primary" disabled={busy}>Create project</button>
      </form>
      {err && <p role="alert" className="mt-2 text-[13px] text-danger">{err}</p>}

      <div className="mt-8">
        {error && <ErrorNote message={error} onRetry={refresh} />}
        {!data && !error && <Spinner />}
        {data && data.projects.length === 0 && <Empty title="No projects yet">Create one above, then upload a video or paste a link.</Empty>}
        {data && data.projects.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="card block px-4 py-4 hover:border-muted">
                  <p className="truncate font-semibold">{p.title}</p>
                  <p className="mt-1 text-[12px] text-muted tc">
                    {p._count.sourceVideos} video{p._count.sourceVideos === 1 ? "" : "s"} · {p._count.clips} clip{p._count.clips === 1 ? "" : "s"} · updated {new Date(p.updatedAt).toLocaleDateString("id-ID")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
