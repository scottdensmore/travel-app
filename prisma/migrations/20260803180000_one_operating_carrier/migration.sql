-- One operating carrier (#72).
--
-- The application called itself Mona Airways while every flight it had ever
-- created was operated by "Gemini Airways", so the site and its own inventory
-- disagreed about who the customer was buying from. The seed now names the
-- product; this brings rows created before that along with it.
--
-- Flight numbers are deliberately left alone. They identify a flight to a
-- customer and appear on bookings already taken, so renumbering existing
-- inventory would change what someone was told they were travelling on.
-- Flights created from here carry the airline's designator; older ones keep the
-- number they were sold under.
UPDATE "Flight" SET "airline" = 'Mona Airways' WHERE "airline" = 'Gemini Airways';
UPDATE "FlightSchedule" SET "airline" = 'Mona Airways' WHERE "airline" = 'Gemini Airways';
