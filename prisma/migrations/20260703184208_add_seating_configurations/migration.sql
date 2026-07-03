-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "businessRows" INTEGER,
ADD COLUMN     "economyRows" INTEGER,
ADD COLUMN     "firstClassRows" INTEGER,
ADD COLUMN     "premiumEconomyRows" INTEGER,
ADD COLUMN     "seatPattern" TEXT;

-- AlterTable
ALTER TABLE "FlightSchedule" ADD COLUMN     "businessRows" INTEGER,
ADD COLUMN     "economyRows" INTEGER,
ADD COLUMN     "firstClassRows" INTEGER,
ADD COLUMN     "premiumEconomyRows" INTEGER,
ADD COLUMN     "seatPattern" TEXT;
