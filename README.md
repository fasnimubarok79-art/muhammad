# CLIPKITA AI PRO MAX

Platform clipping dan editing video: upload video atau tempel link, server mentranskripsi audio dengan Whisper, mengusulkan klip berbasis kalimat utuh, membuat subtitle karaoke yang sinkron per kata, lalu merender MP4 H.264/AAC 1080×1920 yang diverifikasi dengan ffprobe.

## Arsitektur

| Bagian | Teknologi | Lokasi |
|---|---|---|
| Web + API | Next.js 14 (App Router), TypeScript, Tailwind | `src/app`, `src/app/api` |
| Database | PostgreSQL + Prisma | `prisma/schema.prisma` |
| Worker | Node (tsx), antrian berbasis tabel `RenderJob` (`FOR UPDATE SKIP LOCKED`) | `worker/` |
| Speech-to-text | Python + faster-whisper (CTranslate2, CPU int8) | `worker/stt/transcribe.py` |
| Video | FFmpeg / FFprobe (proses dijalankan dengan argumen array, tanpa shell) | `src/lib/media/` |
| Storage | Disk privat di `STORAGE_DIR`, hanya disajikan ke pemilik lewat API | `src/lib/storage.ts` |

Redis/BullMQ sengaja tidak dipakai: antrian di PostgreSQL cukup untuk satu atau beberapa worker dan mengurangi satu layanan yang harus dijalankan.

Alur job: `queued → validating → downloading → analyzing → transcribing → editing → rendering → completed | failed | cancelled`.

## Menjalankan secara lokal

Prasyarat: Node 22, PostgreSQL 14+, FFmpeg + FFprobe, Python 3.10+. Font subtitle sudah disertakan di `worker/fonts`.

```bash
npm ci
```
```bash
cp .env.example .env   # isi DATABASE_URL, SECRET_KEY, OWNER_INITIAL_PASSWORD, dll.
```
```bash
npx prisma migrate deploy
```
```bash
npm run db:seed        # membuat Owner Admin satu kali (idempotent)
```
```bash
python3 -m venv .venv && .venv/bin/pip install -r worker/stt/requirements.txt
```
```bash
npm run build && npm start      # web di :3000
```
```bash
npm run worker                  # di terminal lain
```

Owner Admin login dengan `OWNER_EMAIL` + `OWNER_INITIAL_PASSWORD`, lalu **wajib** mengganti password sebelum bisa memakai aplikasi. Lupa password owner? Jalankan `npm run owner:reset` di server: password kembali ke `OWNER_INITIAL_PASSWORD` dari `.env` dan wajib diganti lagi saat login. Seed tidak pernah mereset password owner yang sudah ada dan tidak pernah mempromosikan akun lain.

### Windows

Dari Command Prompt (Node.js dan Git sudah terpasang):

```bash
cd /d C:\
```
```bash
git clone https://github.com/fasnimubarok79-art/muhammad clipkita-pro
```
```bash
powershell -ExecutionPolicy Bypass -File C:\clipkita-pro\scripts\setup-windows.ps1
```
```bash
powershell -ExecutionPolicy Bypass -File C:\clipkita-pro\scripts\start-windows.ps1
```

Skrip setup memasang Python ke `C:\Python312` dan FFmpeg ke `C:\ffmpeg`, membuka halaman unduhan PostgreSQL bila belum terpasang, membuat database dan `.env`, memasang faster-whisper, lalu build. Font subtitle (Inter Black, SIL OFL) sudah ada di `worker/fonts`, jadi tidak perlu dipasang. Skrip ini belum diuji di mesin Windows sungguhan.

## Token

| Aktivitas | Biaya |
|---|---:|
| Saldo awal pengguna baru (sekali per akun) | +500 |
| Render (editing job) 450p / 720p | 5 |
| Render 1080p | 5 + 400 |
| Download file hasil (sekali per file, ulang gratis) | 10 |
| Upload, analisis, galeri, preview | 0 |
| Owner Admin | tidak pernah dipotong |

Harga ditampilkan sebelum konfirmasi; server menolak render bila total yang dikonfirmasi berbeda (`PRICE_CHANGED`). Potongan memakai UPDATE bersyarat dalam transaksi + idempotency key, dan refund otomatis bila job gagal/dibatalkan/worker mati.

## Keamanan yang diterapkan

- Password scrypt, sesi di DB (cookie httpOnly, SameSite=Lax, Secure di production), token CSRF per sesi + pemeriksaan Origin untuk semua request yang mengubah data.
- Rate limit per IP/pengguna (login, register, reset, import, upload, render). Catatan: in-memory per instance; pakai store bersama bila menjalankan beberapa instance web.
- Cek kepemilikan di setiap query (IDOR/BOLA → 404).
- SSRF: hanya http/https port 80/443, tanpa kredensial di URL, blokir hostname internal dan semua rentang IP privat/reserved (IPv4 + IPv6, termasuk IPv4-mapped/NAT64/6to4), DNS diresolve sekali lalu koneksi di-pin ke IP tervalidasi (anti DNS rebinding), redirect manual dan divalidasi ulang, timeout dan batas ukuran.
- Upload di-stream ke disk dengan batas ukuran, lalu divalidasi FFprobe. Media privat hanya lewat API dengan cek pemilik.
- Header keamanan (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy).
- Token OAuth disimpan terenkripsi AES-256-GCM dan tidak pernah dikirim ke browser.

## Universal link import

| Sumber | Status | Alasan |
|---|---|---|
| File video langsung publik (.mp4, dll.) | `PROCESSABLE` | Diunduh worker dengan proteksi SSRF dan batas ukuran |
| YouTube, TikTok | `PREVIEW_ONLY` | Embed resmi; platform tidak memberi file media ke aplikasi pihak ketiga → upload file asli |
| Instagram, Facebook | `AUTHORIZATION_REQUIRED` (tanpa `META_APP_TOKEN`) / `PREVIEW_ONLY` | Sama, plus butuh token Meta untuk preview |
| Lainnya / tidak valid / privat | `UNSUPPORTED` | Disertai alasan dan opsi upload |

Aplikasi tidak memakai yt-dlp dan tidak melewati login, DRM, paywall, atau pembatasan platform.

## Pengujian

```bash
npm run typecheck && npm run lint
```
```bash
npm test                                    # unit + keamanan + ledger token (butuh DATABASE_URL)
```
```bash
TEST_VIDEO=/path/video-dengan-ucapan.mp4 npm test   # + tes pipeline nyata (Whisper + render)
```
```bash
BASE=http://localhost:3000 TEST_VIDEO=... OWNER_EMAIL=... OWNER_INITIAL_PASSWORD=... node tests/e2e/api-e2e.mjs
```

Tes E2E mengganti password owner. Jalankan hanya pada database uji.

## Belum tersedia / belum terverifikasi

- Publikasi langsung ke TikTok/YouTube/Instagram/Facebook: alur OAuth (PKCE + state) sudah ditulis tetapi **belum diuji** dengan aplikasi platform sungguhan; upload via API belum diimplementasikan. Publish Studio menyediakan export + panduan manual.
- Email reset password: token dan alurnya bekerja, tetapi transport email belum diimplementasikan (`SMTP_URL`).
- Editor: track subtitle, trim, framing, preset, waveform, undo/redo, autosave sudah berfungsi. Overlay teks/gambar/logo, sticker, transisi antar-klip, efek per-segmen, speed control, dan multi-track video belum ada.
- AI Script, judul/caption generatif: belum ada provider LLM. Saran judul/caption/hashtag saat ini diambil dari transkrip asli, bukan dikarang.
- Dockerfile belum pernah di-build dan dites.
