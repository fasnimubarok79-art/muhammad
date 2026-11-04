"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/app/AppShell";
import { useSession } from "@/components/app/session";
import { Ruler } from "@/components/ui/bits";
import { guessPlatform } from "@/components/app/ImportPanel";

const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", direct: "Video file", upload: "File upload" };

const STEPS = [
  { t: "00:00", title: "Bring the video", body: "Paste a public YouTube, TikTok, Instagram or Facebook link and confirm you may use it, or upload a file. The official player shows the video before anything is downloaded." },
  { t: "00:12", title: "Whisper listens", body: "Audio is transcribed on the server with word-level timestamps. Silences and scene changes are measured with FFmpeg." },
  { t: "00:31", title: "Clips are proposed", body: "Windows that start and end on whole sentences are scored on hook, pacing, dead air and topic. Each score shows its reasons." },
  { t: "00:47", title: "You edit, it renders", body: "Fix words, trim, pick a look. The render is a real H.264/AAC MP4 at 1080×1920, checked with ffprobe before you can download it." },
];

const FAQ = [
  { q: "Which links can be processed?", a: "Public videos on YouTube, TikTok, Instagram and Facebook, plus direct links to video files. You confirm that you own the video or have permission before it is fetched. Private, login-only, live and DRM-protected videos are refused, and nothing bypasses those restrictions. Reposting other people's videos can infringe their copyright." },
  { q: "What do tokens pay for?", a: "A render costs 5 tokens, plus 400 for 1080p. Downloading a finished file costs 10 tokens once; downloading it again is free. Uploading, analysis, browsing the gallery and watching previews cost nothing. Failed renders are refunded automatically." },
  { q: "Is the score a promise of views?", a: "No. It is an estimate built from measurable signals in your own clip: the opening sentence, words per second, silence, whether it ends on a full sentence, length and topic. The editor shows every factor." },
  { q: "Are the subtitles really from the audio?", a: "Yes. They come from the Whisper transcript with per-word timing, so the highlighted word follows the speech while you play or seek. If speech recognition fails, the job fails; no placeholder text is inserted." },
  { q: "Who can see my videos?", a: "Only you. Files sit in private server storage and are streamed only to the signed-in owner. Nothing is published to social platforms unless you do it." },
];

export default function Landing() {
  const { user } = useSession();
  const router = useRouter();
  const [link, setLink] = useState("");
  const detected = guessPlatform(link);
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
        <section className="relative overflow-hidden px-4 pb-16 pt-16 lg:pt-24">
          <div className="mx-auto max-w-5xl text-center">
            <p className="text-[13px] font-semibold text-edit tc">00:00:00 → 00:00:47 · one long video, the moments worth posting</p>
            <h1 className="mx-auto mt-5 max-w-4xl text-[clamp(44px,7.2vw,96px)] font-extrabold leading-[0.98]" style={{ fontStretch: "118%" }}>
              Paste a link. Get the <span className="text-edit">clips</span> worth posting.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted">
              ClipKita-Pro fetches your public YouTube, TikTok, Instagram or Facebook video, transcribes every word, finds moments that start and end on whole sentences, and renders vertical clips with word-by-word captions.
            </p>
            <form className="mx-auto mt-10 max-w-3xl" onSubmit={(e) => { e.preventDefault(); start(true); }}>
              <div className="card flex flex-col gap-2 p-2 shadow-float sm:flex-row sm:items-center">
                <label htmlFor="hero-link" className="sr-only">Paste Video Link</label>
                <div className="relative min-w-0 flex-1">
                  <input id="hero-link" className="h-14 w-full rounded-ctl bg-transparent px-4 pr-28 text-[16px] text-ink outline-none placeholder:text-faint" inputMode="url" placeholder="Paste a YouTube, TikTok, Instagram or Facebook link" value={link} onChange={(e) => setLink(e.target.value)} />
                  {detected && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-surface2 px-2.5 py-1 text-[12px] font-semibold text-system">{PLATFORM_LABEL[detected]}</span>}
                </div>
                <button className="btn-primary h-14 shrink-0 px-7 text-[15px]">Get clips</button>
              </div>
            </form>
            <ul className="mt-4 flex flex-wrap justify-center gap-2 text-[12px]" aria-label="Supported sources">
              {(["youtube", "tiktok", "instagram", "facebook", "upload"] as const).map((k) => (
                <li key={k} className={`rounded-full border px-3 py-1 transition-colors duration-[180ms] ${detected === k ? "border-system text-system" : "border-line text-muted"}`}>{PLATFORM_LABEL[k]}</li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-faint">
              Public videos only, and only ones you own or may use. Or <button className="underline underline-offset-4 hover:text-ink" onClick={() => start(false)}>upload a file</button>. New accounts get 500 tokens.
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-6xl items-center gap-8 lg:grid-cols-[1.5fr_auto_1fr]">
            <figure className="card overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/examples/before-16x9.jpg" alt="Landscape source video frame" className="w-full" width={800} height={450} />
              <div className="px-4 pb-4 pt-3">
                <div className="flex justify-between text-[11px] text-faint tc"><span>00:00</span><span>source · 00:25.5</span></div>
                <div className="relative mt-1.5 h-8 rounded-[6px] bg-surface2">
                  <Ruler className="absolute inset-x-0 top-0 opacity-70" />
                  <div className="absolute inset-y-1 rounded-[4px] border border-edit bg-edit/20" style={{ left: `${(5.14 / 25.5) * 100}%`, width: `${((25.11 - 5.14) / 25.5) * 100}%` }}>
                    <span className="absolute -top-6 left-0 whitespace-nowrap text-[11px] font-semibold text-edit tc">00:05.14 → 00:25.11 · score 79 (est.)</span>
                  </div>
                </div>
                <figcaption className="mt-3 text-[12px] leading-relaxed text-muted">The clip window chosen by ClipKita-Pro on the sample: it starts on a full sentence and skips the silent intro.</figcaption>
              </div>
            </figure>

            <div aria-hidden className="hidden text-center text-[13px] font-semibold text-edit lg:block tc">→<br />render</div>

            <figure className="mx-auto w-[min(280px,72vw)]">
              <div className="rounded-[28px] border border-line bg-black p-2 shadow-float">
                <video className="aspect-[9/16] w-full rounded-[20px] object-cover" src="/examples/demo-9x16.mp4" poster="/examples/demo-poster.jpg" autoPlay muted loop playsInline aria-label="Real 9:16 render with karaoke captions" />
              </div>
              <figcaption className="mt-3 text-center text-[12px] leading-relaxed text-muted">Real output: 1080×1920, fit+blur reframing, karaoke captions timed by Whisper. Sample: colour bars with the 1961 JFK inaugural address (public domain).</figcaption>
            </figure>
          </div>
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
