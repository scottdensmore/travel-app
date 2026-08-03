-- Store flight and schedule fares as an integer number of minor units.
--
-- The fare is a formatted string ("$350"), so every consumer parses text the
-- application itself formatted. That round trip breaks the moment formatting
-- changes, and a formatted string cannot be compared, summed or sorted in the
-- database -- which is why sorting and filtering search results happens in the
-- browser today, on numbers recovered from display text (#70).
--
-- This is the same correction #107 made for the booking total, for the same
-- reasons and in the same shape.
--
-- The string columns are deliberately retained and still written. Reads move to
-- the integer in this change; dropping the strings is a separate step once the
-- backfill has been observed in a deployed environment.
ALTER TABLE "Flight" ADD COLUMN "priceCents" INTEGER;
ALTER TABLE "FlightSchedule" ADD COLUMN "priceCents" INTEGER;

-- Backfill only values the application could have written: an optional dollar
-- sign, optional thousands separators, and at most two decimal places. Anything
-- else stays NULL and falls back to parsing the string, which is what every
-- reader does today.
UPDATE "Flight"
SET "priceCents" = ROUND(
    REPLACE(REPLACE("price", '$', ''), ',', '')::numeric * 100
)::integer
WHERE "price" ~ '^\$?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]{1,2})?$';

UPDATE "FlightSchedule"
SET "priceCents" = ROUND(
    REPLACE(REPLACE("price", '$', ''), ',', '')::numeric * 100
)::integer
WHERE "price" ~ '^\$?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]{1,2})?$';

-- A fare is never negative. The column stays nullable during the expand phase
-- because a row whose string could not be parsed has nothing to put here.
ALTER TABLE "Flight"
    ADD CONSTRAINT "Flight_priceCents_check" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
ALTER TABLE "FlightSchedule"
    ADD CONSTRAINT "FlightSchedule_priceCents_check" CHECK ("priceCents" IS NULL OR "priceCents" >= 0);
