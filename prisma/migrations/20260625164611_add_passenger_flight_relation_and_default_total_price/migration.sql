/*
  Warnings:

  - A unique constraint covering the columns `[flightId,seatNumber]` on the table `Passenger` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `flightId` to the `Passenger` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "totalPrice" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "flightId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Passenger_flightId_seatNumber_key" ON "Passenger"("flightId", "seatNumber");

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
