-- Reference data for the places routes fly between.
--
-- "label" carries the free-text value "Flight"."from" and "Flight"."to" hold
-- today, so a route can resolve its origin airport before those columns become
-- real references. It is unique because it is used as a lookup key.
CREATE TABLE "Airport" (
    "iataCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,

    CONSTRAINT "Airport_pkey" PRIMARY KEY ("iataCode")
);

CREATE UNIQUE INDEX "Airport_label_key" ON "Airport"("label");
