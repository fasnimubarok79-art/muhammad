-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "engagementScore" DOUBLE PRECISION,
ADD COLUMN     "hookScore" DOUBLE PRECISION,
ADD COLUMN     "hookText" TEXT,
ADD COLUMN     "insights" JSONB,
ADD COLUMN     "targetDuration" INTEGER;

