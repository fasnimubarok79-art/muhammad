# ClipKita-Pro

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
# setelah git pull: npm ci, npm run backup, npm run db:migrate, npm run build (start-windows.ps1 menjalankan backup + migrate otomatis)
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

## Backup dan pemulihan

```bash
npm run backup -- --with-tests
```

Membuat folder baru `CLIPKITA_BACKUP/clipkita-<waktu>-<commit>/` (default di sebelah folder project, atau `BACKUP_DIR`) berisi 01_SOURCE_CODE, 02_DATABASE (dump terenkripsi + schema + migrasi + jumlah baris), 03_ASSETS (video/render/thumbnail terenkripsi), 04_CONFIGURATION (template, tanpa nilai rahasia), 05_DOCUMENTATION, 06_DEPENDENCIES, 07_TEST_REPORT, 08_RECOVERY_TOOLS, plus `BACKUP_MANIFEST.md`, `BACKUP_CHECKSUMS.txt`, `BACKUP_VERSION.txt`. Backup lama tidak pernah ditimpa. Database dan file media dienkripsi AES-256-GCM dengan kunci di `BACKUP_KEY_FILE` (default `../CLIPKITA_BACKUP_KEY/backup.key`), di luar folder backup: simpan salinan kunci ini di tempat aman.

```bash
npm run backup:restore -- --from <folder backup> --verify-only
```
```bash
npm run backup:restore -- --from <folder backup> --to <folder baru kosong>
```

Restore selalu ke folder baru dan database baru (`clipkita_restore_<waktu>`), memeriksa checksum dan kunci sebelum menulis apa pun, lalu membandingkan jumlah baris. Project dan database aktif tidak pernah disentuh. Lihat `scripts/backup/RECOVERY.md`.

## Pindah ke nama baru (instalasi lama)

`.env` lama tetap berjalan tanpa perubahan. Untuk memakai nama baru:

1. Ganti nama variabel menjadi berawalan `CKP_` (contoh `SECRET_KEY` menjadi `CKP_SECRET_KEY`). Bila keduanya ada, `CKP_` yang dipakai. `DATABASE_URL` tidak diganti.
2. Pindahkan database ke `clipkita_pro` tanpa menyentuh database lama:

```bash
npm run backup
```
```bash
npm run backup:restore -- --from "C:\CLIPKITA_BACKUP\<folder-terbaru>" --to "C:\clipkita-pro-restore-check" --db clipkita_pro
```

   Setelah `RESTORE OK`, ubah akhir `DATABASE_URL` di `.env` dari `/clipkita` menjadi `/clipkita_pro`, lalu jalankan aplikasi. Database lama `clipkita` tetap ada sebagai cadangan sampai Anda menghapusnya sendiri.

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
- Editor (Phase 4): timeline multi-track (video utama, B-roll, overlay, teks, efek, audio, subtitle, kartu kata), media library, move/trim/split/duplicate/hapus/ripple delete, lock/mute/hide track, marker, keyframe posisi/skala/opacity/volume (linear dan ease), speed 0,25–4×, undo/redo, autosave dengan cek versi. Preview browser adalah perkiraan; grade warna dan blur di preview memakai filter CSS, hasil render FFmpeg adalah acuan. Belum ada: sticker, transisi antar-klip (selain flash), light leak, rotasi/crop pada video utama dengan keyframe, ganti audio sumber, proxy preview untuk file besar.
- AI Script, judul/caption generatif: belum ada provider LLM. Saran judul/caption/hashtag saat ini diambil dari transkrip asli, bukan dikarang.
- Dockerfile belum pernah di-build dan dites.
