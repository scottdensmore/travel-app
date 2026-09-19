SET LOCAL lock_timeout = '3s';

-- AlterTable
ALTER TABLE "Flight" ADD COLUMN "departureTerminal" TEXT,
ADD COLUMN "departureGate" TEXT,
ADD COLUMN "arrivalTerminal" TEXT,
ADD COLUMN "arrivalGate" TEXT,
ADD COLUMN "delayReason" TEXT,
ADD COLUMN "estimatedDeparture" TIMESTAMPTZ(3),
ADD COLUMN "actualDeparture" TIMESTAMPTZ(3),
ADD COLUMN "estimatedArrival" TIMESTAMPTZ(3),
ADD COLUMN "actualArrival" TIMESTAMPTZ(3);
