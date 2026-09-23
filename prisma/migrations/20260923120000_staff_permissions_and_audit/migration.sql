SET LOCAL lock_timeout = '3s';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPPORT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MODERATOR';

-- CreateTable
CREATE TABLE "StaffAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAuditLog_actorId_idx" ON "StaffAuditLog"("actorId");
CREATE INDEX "StaffAuditLog_action_idx" ON "StaffAuditLog"("action");
CREATE INDEX "StaffAuditLog_targetType_targetId_idx" ON "StaffAuditLog"("targetType", "targetId");
CREATE INDEX "StaffAuditLog_createdAt_idx" ON "StaffAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "StaffAuditLog" ADD CONSTRAINT "StaffAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
