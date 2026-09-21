SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('APPROVED', 'PENDING_MODERATION', 'HIDDEN');
CREATE TYPE "ReviewReportReason" AS ENUM ('SPAM', 'OFFENSIVE', 'HARASSMENT', 'MISINFORMATION', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ModerationAction" AS ENUM ('APPROVE', 'HIDE', 'DISMISS_REPORTS', 'DELETE');

-- Deduplicate existing legacy reviews keeping the most recently created
DELETE FROM "Review" r1
USING "Review" r2
WHERE r1."userId" = r2."userId"
  AND r1."cityGuideId" = r2."cityGuideId"
  AND r1."createdAt" < r2."createdAt";

-- AlterTable
ALTER TABLE "Review"
  ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable ReviewReport
CREATE TABLE "ReviewReport" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ReviewReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable ReviewModerationAudit
CREATE TABLE "ReviewModerationAudit" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT,
    "moderatorId" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewModerationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_cityGuideId_key" ON "Review"("userId", "cityGuideId");
CREATE INDEX "Review_cityGuideId_status_idx" ON "Review"("cityGuideId", "status");
CREATE INDEX "Review_status_idx" ON "Review"("status");

CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterId_key" ON "ReviewReport"("reviewId", "reporterId");
CREATE INDEX "ReviewReport_reviewId_status_idx" ON "ReviewReport"("reviewId", "status");
CREATE INDEX "ReviewReport_status_idx" ON "ReviewReport"("status");

CREATE INDEX "ReviewModerationAudit_reviewId_idx" ON "ReviewModerationAudit"("reviewId");
CREATE INDEX "ReviewModerationAudit_moderatorId_idx" ON "ReviewModerationAudit"("moderatorId");
CREATE INDEX "ReviewModerationAudit_createdAt_idx" ON "ReviewModerationAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewModerationAudit" ADD CONSTRAINT "ReviewModerationAudit_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewModerationAudit" ADD CONSTRAINT "ReviewModerationAudit_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
