SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "PointsTransactionType" AS ENUM ('WELCOME_GRANT', 'FLIGHT_EARN', 'REWARD_REDEMPTION', 'REWARD_REFUND', 'ADMIN_ADJUSTMENT');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "isRewardBooking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pointsRedeemed" INTEGER;

-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "awardSeatsBusiness" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "awardSeatsEconomy" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "awardSeatsFirst" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "awardSeatsPremiumEconomy" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "FlightSchedule" ADD COLUMN     "awardSeatsBusiness" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "awardSeatsEconomy" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "awardSeatsFirst" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "awardSeatsPremiumEconomy" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "PointsLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "bookingId" INTEGER,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointsLedgerEntry_userId_createdAt_idx" ON "PointsLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsLedgerEntry_bookingId_idx" ON "PointsLedgerEntry"("bookingId");

-- AddForeignKey
ALTER TABLE "PointsLedgerEntry" ADD CONSTRAINT "PointsLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsLedgerEntry" ADD CONSTRAINT "PointsLedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
