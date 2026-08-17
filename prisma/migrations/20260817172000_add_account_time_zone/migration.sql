-- Give account activity a persistent timezone chosen by the customer. Existing
-- accounts receive UTC as an explicit fallback; the UI labels it rather than
-- inheriting whichever browser happens to render the page.
--
-- Manual reversal:
--   ALTER TABLE "User" DROP CONSTRAINT "User_timeZone_well_formed";
--   ALTER TABLE "User" DROP COLUMN "timeZone";

ALTER TABLE "User"
ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE "User"
ADD CONSTRAINT "User_timeZone_well_formed"
CHECK (
    "timeZone" = btrim("timeZone")
    AND char_length("timeZone") BETWEEN 1 AND 100
);
