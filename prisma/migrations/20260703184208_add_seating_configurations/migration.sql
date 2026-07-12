-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "businessRows" INTEGER,
ADD COLUMN     "economyRows" INTEGER,
ADD COLUMN     "firstClassRows" INTEGER,
ADD COLUMN     "premiumEconomyRows" INTEGER,
ADD COLUMN     "seatPattern" TEXT;

UPDATE "Flight"
SET "firstClassRows" = 3,
    "businessRows" = 3,
    "premiumEconomyRows" = 4,
    "economyRows" = 20,
    "seatPattern" = 'ABC-DEF';

-- AlterTable
ALTER TABLE "FlightSchedule" ADD COLUMN     "businessRows" INTEGER,
ADD COLUMN     "economyRows" INTEGER,
ADD COLUMN     "firstClassRows" INTEGER,
ADD COLUMN     "premiumEconomyRows" INTEGER,
ADD COLUMN     "seatPattern" TEXT;

UPDATE "FlightSchedule"
SET "firstClassRows" = 3,
    "businessRows" = 3,
    "premiumEconomyRows" = 4,
    "economyRows" = 20,
    "seatPattern" = 'ABC-DEF';
