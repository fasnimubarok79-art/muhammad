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

| Sumber | Status | Cara |
|---|---|---|
| YouTube, TikTok, Instagram, Facebook (video publik) | `PROCESSABLE` setelah pengguna mencentang hak | Diunduh worker dengan yt-dlp: hanya extractor keempat platform itu, tanpa cookie/login, tanpa live, batas ukuran dan durasi |
| File video langsung publik (.mp4, dll.) | `PROCESSABLE` | Diunduh dengan `safeRequest` (proteksi SSRF) |
| Video privat, butuh login, live, DRM | gagal dengan pesan jelas | Tidak dibobol; pengguna diminta upload file asli |
| Lainnya / tidak valid / alamat privat | `UNSUPPORTED` | Disertai alasan dan opsi upload |

Matikan dengan `LINK_IMPORT=0`. yt-dlp perlu diperbarui berkala karena platform sering berubah: `.venv\Scripts\pip install -U "yt-dlp[default]"`. YouTube memerlukan JavaScript runtime (`YTDLP_JS_RUNTIME=node`, sudah default). Mengunggah ulang video milik orang lain bisa melanggar hak cipta; aplikasi mencatat konfirmasi hak di audit log.

## Login admin

Owner Admin bisa login dengan email `OWNER_EMAIL` **atau** username `OWNER_USERNAME` (default `ADMINPRO16112000`, tidak peka huruf besar/kecil). Password awal diambil dari `OWNER_INITIAL_PASSWORD` di `.env` (minimal 8 karakter) dan wajib diganti saat login pertama. Password tidak pernah disimpan di kode atau Git.

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

- Unduh dari YouTube/TikTok/Instagram/Facebook diuji dengan yt-dlp terhadap server lokal; unduhan dari platform aslinya belum bisa diuji di lingkungan pengembangan (jaringan diblokir).
- Publikasi langsung ke TikTok/YouTube/Instagram/Facebook: alur OAuth (PKCE + state) sudah ditulis tetapi **belum diuji** dengan aplikasi platform sungguhan; upload via API belum diimplementasikan. Publish Studio menyediakan export + panduan manual.
- Email reset password: token dan alurnya bekerja, tetapi transport email belum diimplementasikan (`SMTP_URL`).
- Reframe Follow face: mengikuti wajah terbesar (subjek utama). Bila beberapa orang terlihat, belum memilih berdasarkan siapa yang sedang bicara.
- Editor: track subtitle, trim, framing, preset, waveform, undo/redo, autosave sudah berfungsi. Overlay teks/gambar/logo, sticker, transisi antar-klip, efek per-segmen, speed control, dan multi-track video belum ada.
- AI Script, judul/caption generatif: belum ada provider LLM. Saran judul/caption/hashtag saat ini diambil dari transkrip asli, bukan dikarang.
- Dockerfile belum pernah di-build dan dites.
