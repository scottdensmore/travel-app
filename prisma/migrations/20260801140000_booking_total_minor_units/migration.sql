-- Store the booking total as an integer number of minor units.
--
-- The total was persisted as a formatted string, so awarding status points
-- meant parsing a string the application had just formatted. That round trip
-- breaks as soon as formatting changes, and a formatted string carries no
-- currency and cannot be compared or summed in the database.
--
-- "totalPrice" is deliberately retained for now. Reads move to the new column
-- in this change; dropping the string column is a separate step once the
-- backfill has been observed in a deployed environment.
ALTER TABLE "Booking"
    ADD COLUMN "totalPriceCents" INTEGER,
    ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- Backfill only values the application could have written: an optional dollar
-- sign, optional thousands separators, and at most two decimal places. Anything
-- else stays NULL and falls back to the flight's catalogue price, which is what
-- an empty total already did.
UPDATE "Booking"
SET "totalPriceCents" = ROUND(
        REPLACE(REPLACE("totalPrice", '$', ''), ',', '')::numeric * 100
    )::integer
WHERE "totalPrice" ~ '^\$?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]{1,2})?$';

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_totalPriceCents_non_negative_check"
CHECK ("totalPriceCents" IS NULL OR "totalPriceCents" >= 0);
