# Web app + worker image. Not built or tested in the development session yet.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-inter python3 python3-venv ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 npx next build

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY worker/stt/requirements.txt /tmp/req.txt
RUN python3 -m venv /opt/clipkita-pro/.venv && /opt/clipkita-pro/.venv/bin/pip install --no-cache-dir -r /tmp/req.txt
COPY --from=build /app /app
RUN useradd -r -u 10001 clipkita && mkdir -p /var/lib/clipkita-pro/storage && chown -R clipkita /var/lib/clipkita
USER clipkita
EXPOSE 3000
# web:    docker run ... clipkita npx next start -p 3000
# worker: docker run ... clipkita npx tsx worker/index.ts
CMD ["npx", "next", "start", "-p", "3000"]
