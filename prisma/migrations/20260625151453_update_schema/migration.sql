/*
  Warnings:

  - A unique constraint covering the columns `[flightNumber,departureDate]` on the table `Flight` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ON_TIME';

-- CreateTable
CREATE TABLE "FlightSchedule" (
    "id" SERIAL NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "returnTime" TEXT,
    "daysOfWeek" INTEGER[],
    "price" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FlightSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Flight_flightNumber_departureDate_key" ON "Flight"("flightNumber", "departureDate");
