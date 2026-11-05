-- Phase 4: media library and multi-track timeline. Additive only: new enums, tables, indexes and FKs.
BEGIN;
-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('VIDEO', 'AUDIO', 'IMAGE');

-- CreateEnum
CREATE TYPE "TrackType" AS ENUM ('VIDEO', 'AUDIO', 'SUBTITLE', 'TEXT', 'OVERLAY', 'BROLL', 'EFFECTS', 'CARDS');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" "MediaKind" NOT NULL,
    "name" TEXT NOT NULL,
    "originalName" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "hasAudio" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timeline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clipId" TEXT,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "durationFrames" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "playheadFrame" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineTrack" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TrackType" NOT NULL,
    "order" INTEGER NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineItem" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "sourceVideoId" TEXT,
    "startFrame" INTEGER NOT NULL,
    "durationFrames" INTEGER NOT NULL,
    "sourceInFrame" INTEGER NOT NULL DEFAULT 0,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "transform" JSONB,
    "effects" JSONB,
    "keyframes" JSONB,
    "config" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineMarker" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "frame" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#FF7A1A',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_idx" ON "MediaAsset"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Timeline_clipId_key" ON "Timeline"("clipId");

-- CreateIndex
CREATE INDEX "Timeline_projectId_idx" ON "Timeline"("projectId");

-- CreateIndex
CREATE INDEX "TimelineTrack_timelineId_order_idx" ON "TimelineTrack"("timelineId", "order");

-- CreateIndex
CREATE INDEX "TimelineItem_trackId_startFrame_idx" ON "TimelineItem"("trackId", "startFrame");

-- CreateIndex
CREATE INDEX "TimelineItem_mediaAssetId_idx" ON "TimelineItem"("mediaAssetId");

-- CreateIndex
CREATE INDEX "TimelineItem_sourceVideoId_idx" ON "TimelineItem"("sourceVideoId");

-- CreateIndex
CREATE INDEX "TimelineMarker_timelineId_frame_idx" ON "TimelineMarker"("timelineId", "frame");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineTrack" ADD CONSTRAINT "TimelineTrack_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "TimelineTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "SourceVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineMarker" ADD CONSTRAINT "TimelineMarker_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "Timeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
