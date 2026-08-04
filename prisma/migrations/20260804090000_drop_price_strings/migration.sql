-- Contract step for the fare (#135).
--
-- "priceCents" has been authoritative since #134, and #144 moved the last
-- readers -- the ones that display money -- onto it. The strings were retained
-- and still written so a rollback of #134 kept a displayable value. Nothing
-- reads them now.
--
-- Any row the original backfill could not parse is filled here rather than
-- left to fail the NOT NULL. There were none on the working database at the
-- time of #134 (1,459 of 1,459 flights and 9 of 9 schedules), so this is a
-- guard for environments that were behind, not an expected path.
UPDATE "Flight"
SET "priceCents" = ROUND(
    REPLACE(REPLACE("price", '$', ''), ',', '')::numeric * 100
)::integer
WHERE "priceCents" IS NULL
  AND "price" ~ '^\$?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]{1,2})?$';

UPDATE "FlightSchedule"
SET "priceCents" = ROUND(
    REPLACE(REPLACE("price", '$', ''), ',', '')::numeric * 100
)::integer
WHERE "priceCents" IS NULL
  AND "price" ~ '^\$?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]{1,2})?$';

-- A row whose fare could be read in neither form cannot be sold. Deleting it
-- would remove inventory customers may hold bookings against, so it is priced
-- at zero and left visible: a fare of nothing is wrong in a way somebody will
-- notice and report, where a missing flight is wrong in a way nobody sees.
UPDATE "Flight" SET "priceCents" = 0 WHERE "priceCents" IS NULL;
UPDATE "FlightSchedule" SET "priceCents" = 0 WHERE "priceCents" IS NULL;

ALTER TABLE "Flight" ALTER COLUMN "priceCents" SET NOT NULL;
ALTER TABLE "FlightSchedule" ALTER COLUMN "priceCents" SET NOT NULL;

-- The check allowed NULL while the column was nullable; it no longer needs to.
ALTER TABLE "Flight" DROP CONSTRAINT IF EXISTS "Flight_priceCents_check";
ALTER TABLE "FlightSchedule" DROP CONSTRAINT IF EXISTS "FlightSchedule_priceCents_check";
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_priceCents_check" CHECK ("priceCents" >= 0);
ALTER TABLE "FlightSchedule" ADD CONSTRAINT "FlightSchedule_priceCents_check" CHECK ("priceCents" >= 0);

ALTER TABLE "Flight" DROP COLUMN "price";
ALTER TABLE "FlightSchedule" DROP COLUMN "price";
