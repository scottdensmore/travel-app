-- Migration: 20260918200000_add_passenger_ancillaries
SET LOCAL lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "AncillaryType" AS ENUM ('CARRY_ON', 'CHECKED_BAG_1', 'CHECKED_BAG_2', 'PRIORITY_BOARDING', 'SPECIAL_ASSISTANCE');

-- CreateTable
CREATE TABLE "PassengerAncillary" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "type" "AncillaryType" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PassengerAncillary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PassengerAncillary_passengerId_type_key" ON "PassengerAncillary"("passengerId", "type");

-- CreateIndex
CREATE INDEX "PassengerAncillary_passengerId_idx" ON "PassengerAncillary"("passengerId");

-- AddForeignKey
ALTER TABLE "PassengerAncillary" ADD CONSTRAINT "PassengerAncillary_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE CASCADE ON UPDATE CASCADE;
