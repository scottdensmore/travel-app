SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');
CREATE TYPE "NotificationCategory" AS ENUM ('FLIGHT_STATUS', 'ACCOUNT_ACTIVITY', 'TRAVEL_GUIDES');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable Notification
ALTER TABLE "Notification" ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'FLIGHT_STATUS';

-- Backfill categories from type
UPDATE "Notification" SET "category" = 'FLIGHT_STATUS' WHERE "type" = 'FLIGHT_STATUS';
UPDATE "Notification" SET "category" = 'ACCOUNT_ACTIVITY' WHERE "type" IN ('POINTS', 'SYSTEM');

-- CreateTable NotificationPreference
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable NotificationDelivery
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_channel_key" ON "NotificationPreference"("userId", "category", "channel");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE INDEX "NotificationDelivery_status_channel_idx" ON "NotificationDelivery"("status", "channel");
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");
CREATE INDEX "NotificationDelivery_createdAt_idx" ON "NotificationDelivery"("createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
