"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/app/AppShell";
import { useSession } from "@/components/app/session";
import { Ruler } from "@/components/ui/bits";

const STEPS = [
  { t: "00:00", title: "Bring the video", body: "Upload your file, or paste a link. Links are checked first: the app tells you whether it can process the file, only preview it, or needs the original upload." },
  { t: "00:12", title: "Whisper listens", body: "Audio is transcribed on the server with word-level timestamps. Silences and scene changes are measured with FFmpeg." },
  { t: "00:31", title: "Clips are proposed", body: "Windows that start and end on whole sentences are scored on hook, pacing, dead air and topic. Each score shows its reasons." },
  { t: "00:47", title: "You edit, it renders", body: "Fix words, trim, pick a look. The render is a real H.264/AAC MP4 at 1080×1920, checked with ffprobe before you can download it." },
];

const FAQ = [
  { q: "Which links can be processed directly?", a: "Public direct video files (a link that ends in .mp4 or similar). YouTube, TikTok, Instagram and Facebook links can be previewed with the official player, but those platforms do not give apps the media file, so you upload the original you own. ClipKita does not bypass logins, DRM, paywalls or platform restrictions." },
  { q: "What do tokens pay for?", a: "A render costs 5 tokens, plus 400 for 1080p. Downloading a finished file costs 10 tokens once; downloading it again is free. Uploading, analysis, browsing the gallery and watching previews cost nothing. Failed renders are refunded automatically." },
  { q: "Is the score a promise of views?", a: "No. It is an estimate built from measurable signals in your own clip: the opening sentence, words per second, silence, whether it ends on a full sentence, length and topic. The editor shows every factor." },
  { q: "Are the subtitles really from the audio?", a: "Yes. They come from the Whisper transcript with per-word timing, so the highlighted word follows the speech while you play or seek. If speech recognition fails, the job fails; no placeholder text is inserted." },
  { q: "Who can see my videos?", a: "Only you. Files sit in private server storage and are streamed only to the signed-in owner. Nothing is published to social platforms unless you do it." },
];

export default function Landing() {
  const { user } = useSession();
  const router = useRouter();
  const [link, setLink] = useState("");
  const start = (withLink: boolean) => {
    if (withLink && link.trim()) sessionStorage.setItem("clipkita:pending-link", link.trim());
    router.push(user ? "/projects" : "/register");
  };
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Wordmark />
        <nav aria-label="Sections" className="hidden gap-5 text-[13px] text-muted md:flex">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#editor" className="hover:text-ink">Editor</a>
          <a href="#tokens" className="hover:text-ink">Tokens</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="ml-auto flex gap-2">
          {user ? (
            <Link href="/dashboard" className="btn-primary h-9">Open dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Log in</Link>
              <Link href="/register" className="btn-primary h-9">Create account</Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-14 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
          <div>
            <p className="text-[13px] font-semibold text-edit tc">00:00:00 → 00:00:47</p>
            <h1 className="mt-4 text-[clamp(36px,5vw,64px)] font-extrabold leading-[1.02]">Turn one long video into short clips people finish.</h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
              ClipKita transcribes your speech, picks moments that start and end on whole sentences, burns in word-by-word subtitles and renders vertical 1080×1920 MP4s you can post anywhere.
            </p>
            <form className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); start(true); }}>
              <label htmlFor="hero-link" className="sr-only">Paste Video Link</label>
              <input id="hero-link" className="field h-12" inputMode="url" placeholder="Paste Video Link" value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="btn-primary h-12 shrink-0 px-6">Check this link</button>
            </form>
            <p className="mt-3 text-[13px] text-muted">
              or <button className="underline underline-offset-4 decoration-faint hover:decoration-ink" onClick={() => start(false)}>upload a video file</button> · new accounts get 500 tokens
            </p>
          </div>

          <figure id="editor" className="card self-start overflow-hidden" aria-label="Real before and after from this pipeline">
            <div className="grid grid-cols-[1.6fr_1fr] gap-3 p-3">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-muted">Before · 16:9 source</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/examples/before-16x9.jpg" alt="Landscape source frame before editing" className="w-full rounded-[6px]" width={800} height={450} />
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-edit">After · 9:16 render</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/examples/after-9x16.jpg" alt="Vertical render with blurred fill and karaoke subtitle" className="w-full rounded-[6px]" width={405} height={720} />
              </div>
            </div>
            <Ruler className="px-3" />
            <figcaption className="px-3 py-3 text-[12px] leading-relaxed text-muted">
              Real output of this pipeline: fit+blur reframing, Viral Short preset, karaoke subtitles from the Whisper transcript. Test source: SMPTE colour bars with the 1961 JFK inaugural address (public domain).
            </figcaption>
          </figure>
        </section>

        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="max-w-2xl text-[clamp(28px,3.5vw,40px)] font-extrabold leading-tight">What happens to your video, in order</h2>
            <ol className="mt-12 grid gap-x-10 gap-y-12 md:grid-cols-2">
              {STEPS.map((s) => (
                <li key={s.t} className="border-t border-line pt-5">
                  <p className="text-[13px] font-semibold text-edit tc">{s.t}</p>
                  <h3 className="mt-2 text-[20px] font-bold">{s.title}</h3>
                  <p className="mt-2 max-w-md leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-[clamp(28px,3.5vw,40px)] font-extrabold leading-tight">An editor, not a slideshow of effects</h2>
            <p className="mt-4 leading-relaxed text-muted">Every control changes the file you export. The preview plays your source with the same framing and subtitle style the renderer uses.</p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
            {[
              ["Subtitle track", "Edit words and timing, split with S, import or export SRT and VTT."],
              ["Trim and reframe", "Drag trim handles, choose fit+blur, crop with a focus point, or bars."],
              ["Five looks", "Cinematic Podcast, Viral Short, Educational, Storytelling, Clean Professional."],
              ["Silence removal", "Cuts pauses longer than 0.6s and keeps subtitles in sync."],
              ["Undo history", "50 steps, autosave to the server and a local draft for recovery."],
              ["Checked exports", "ffprobe confirms codec, size and duration before you pay to download."],
            ].map(([t, d]) => (
              <div key={t} className="bg-surface p-5">
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1.5 text-[13px] leading-relaxed text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="tokens" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[1fr_1fr]">
            <div>
              <h2 className="text-[clamp(28px,3.5vw,40px)] font-extrabold leading-tight">Tokens, with the price shown before every charge</h2>
              <p className="mt-4 leading-relaxed text-muted">You see the total before confirming. A failed render gives the tokens back. Watching previews and browsing your clips is always free.</p>
            </div>
            <table className="w-full text-[14px]">
              <caption className="sr-only">Token prices</caption>
              <tbody className="divide-y divide-line">
                {[
                  ["Starting balance for a new account", "500"],
                  ["Render a clip (450p or 720p)", "5"],
                  ["Render a clip in 1080p", "5 + 400"],
                  ["Download a finished file (once per file)", "10"],
                  ["Upload, analysis, gallery, previews", "0"],
                ].map(([a, b]) => (
                  <tr key={a}>
                    <th scope="row" className="py-3 pr-4 text-left font-normal text-muted">{a}</th>
                    <td className="py-3 text-right font-semibold tc">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="text-[clamp(28px,3.5vw,40px)] font-extrabold">Questions</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex list-none items-center justify-between gap-4 font-semibold">
                  {f.q}
                  <span aria-hidden className="text-muted transition-transform duration-[180ms] ease-out group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-[13px] text-muted">
          <Wordmark />
          <span>Video clipping and editing on your own server.</span>
          <span className="ml-auto flex gap-4">
            <Link href="/login" className="hover:text-ink">Log in</Link>
            <Link href="/register" className="hover:text-ink">Create account</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
