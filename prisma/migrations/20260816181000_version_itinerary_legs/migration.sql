-- Preserve every itinerary a booking has held while allowing one position to
-- be replaced after an airline disruption.
--
-- Reversal (there are no automated down migrations):
--
--     DROP TRIGGER "BookingRebookingLeg_is_append_only" ON "BookingRebookingLeg";
--     DROP TRIGGER "BookingRebookingLeg_preserves_supersession" ON "BookingRebookingLeg";
--     DROP TRIGGER "BookingRebooking_is_append_only" ON "BookingRebooking";
--     DROP TRIGGER "BookingRebooking_has_legs" ON "BookingRebooking";
--     DROP TRIGGER "BookingRebookingLeg_is_consistent" ON "BookingRebookingLeg";
--     DROP TRIGGER "BookingRebooking_is_consistent" ON "BookingRebooking";
--     DROP TRIGGER "ItineraryLeg_supersession_is_recorded" ON "ItineraryLeg";
--     DROP TRIGGER "ItineraryLeg_supersession_is_permanent" ON "ItineraryLeg";
--     DROP TRIGGER "ItineraryLeg_starts_active" ON "ItineraryLeg";
--     DROP TRIGGER "ItineraryLeg_deletes_with_booking" ON "ItineraryLeg";
--     DROP FUNCTION "refuse_rebooking_audit_update"();
--     DROP FUNCTION "require_supersession_mapping_after_delete"();
--     DROP FUNCTION "require_rebooking_legs"();
--     DROP FUNCTION "validate_booking_rebooking_leg"();
--     DROP FUNCTION "validate_booking_rebooking"();
--     DROP FUNCTION "require_recorded_leg_supersession"();
--     DROP FUNCTION "refuse_itinerary_leg_rewrite"();
--     DROP FUNCTION "require_new_itinerary_leg_active"();
--     DROP FUNCTION "require_itinerary_leg_booking_delete"();
--     DROP TABLE "BookingRebookingLeg";
--     DROP TABLE "BookingRebooking";
--     DROP TYPE "RebookingFarePolicy";
--     DROP INDEX "ItineraryLeg_active_booking_sequence_key";
--     DROP INDEX "ItineraryLeg_bookingId_supersededAt_sequence_idx";
--     ALTER TABLE "ItineraryLeg" DROP COLUMN "supersededAt";
--     CREATE UNIQUE INDEX "ItineraryLeg_bookingId_sequence_key"
--         ON "ItineraryLeg"("bookingId", "sequence");
--
-- The reversal is safe only before a rebooking exists. Once two historical
-- rows share a sequence, restoring the unconditional unique key is impossible
-- without deleting audit history.

CREATE TYPE "RebookingFarePolicy" AS ENUM ('DISRUPTION_WAIVER');

ALTER TABLE "ItineraryLeg"
    ADD COLUMN "supersededAt" TIMESTAMP(3);

DROP INDEX "ItineraryLeg_bookingId_sequence_key";

-- Historical rows may share a position; exactly one current row may not.
CREATE UNIQUE INDEX "ItineraryLeg_active_booking_sequence_key"
    ON "ItineraryLeg"("bookingId", "sequence")
    WHERE "supersededAt" IS NULL;

CREATE INDEX "ItineraryLeg_bookingId_supersededAt_sequence_idx"
    ON "ItineraryLeg"("bookingId", "supersededAt", "sequence");

CREATE TABLE "BookingRebooking" (
    "id" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "bookingStatusChangeId" TEXT NOT NULL,
    "farePolicy" "RebookingFarePolicy" NOT NULL DEFAULT 'DISRUPTION_WAIVER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRebooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingRebooking_bookingStatusChangeId_key"
    ON "BookingRebooking"("bookingStatusChangeId");
CREATE INDEX "BookingRebooking_bookingId_createdAt_idx"
    ON "BookingRebooking"("bookingId", "createdAt");

ALTER TABLE "BookingRebooking"
    ADD CONSTRAINT "BookingRebooking_bookingId_fkey"
        FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "BookingRebooking_bookingStatusChangeId_fkey"
        FOREIGN KEY ("bookingStatusChangeId") REFERENCES "BookingStatusChange"("id")
        ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "BookingRebookingLeg" (
    "rebookingId" TEXT NOT NULL,
    "fromLegId" INTEGER NOT NULL,
    "toLegId" INTEGER NOT NULL,

    CONSTRAINT "BookingRebookingLeg_pkey" PRIMARY KEY ("rebookingId", "fromLegId"),
    CONSTRAINT "BookingRebookingLeg_different_legs" CHECK ("fromLegId" <> "toLegId")
);

CREATE UNIQUE INDEX "BookingRebookingLeg_fromLegId_key"
    ON "BookingRebookingLeg"("fromLegId");
CREATE UNIQUE INDEX "BookingRebookingLeg_toLegId_key"
    ON "BookingRebookingLeg"("toLegId");

ALTER TABLE "BookingRebookingLeg"
    ADD CONSTRAINT "BookingRebookingLeg_rebookingId_fkey"
        FOREIGN KEY ("rebookingId") REFERENCES "BookingRebooking"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "BookingRebookingLeg_fromLegId_fkey"
        FOREIGN KEY ("fromLegId") REFERENCES "ItineraryLeg"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "BookingRebookingLeg_toLegId_fkey"
        FOREIGN KEY ("toLegId") REFERENCES "ItineraryLeg"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- Every historical leg has to become historical through the recorded update
-- below. Accepting a row that starts superseded would bypass that audit path.
CREATE FUNCTION "require_new_itinerary_leg_active"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."supersededAt" IS NOT NULL THEN
        RAISE EXCEPTION
            'A new ItineraryLeg must start active; supersede it through a recorded rebooking.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ItineraryLeg_starts_active"
    BEFORE INSERT ON "ItineraryLeg"
    FOR EACH ROW EXECUTE FUNCTION "require_new_itinerary_leg_active"();

-- A leg disappears only when its whole booking does. Deferred so the booking
-- cascade has removed the parent by the time this checks it; a direct leg
-- delete, even beside deletion of its audit mapping, still sees the booking.
CREATE FUNCTION "require_itinerary_leg_booking_delete"()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Booking" WHERE "id" = OLD."bookingId") THEN
        RAISE EXCEPTION
            'ItineraryLeg % cannot be deleted while booking % exists.',
            OLD."id", OLD."bookingId";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ItineraryLeg_deletes_with_booking"
    AFTER DELETE ON "ItineraryLeg"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "require_itinerary_leg_booking_delete"();

-- A leg's identity never changes in place: a different flight is a new version.
-- Once superseded, its timestamp is permanent too. The sole state transition
-- this permits is setting supersededAt on a currently active leg.
CREATE FUNCTION "refuse_itinerary_leg_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
       OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
       OR NEW."flightId" IS DISTINCT FROM OLD."flightId" THEN
        RAISE EXCEPTION
            'ItineraryLeg identity is immutable: replace leg % with a new version.',
            OLD."id";
    END IF;
    IF OLD."supersededAt" IS NOT NULL
       AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
        RAISE EXCEPTION
            'ItineraryLeg supersession is permanent: leg % cannot become active or change time.',
            OLD."id";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ItineraryLeg_supersession_is_permanent"
    BEFORE UPDATE ON "ItineraryLeg"
    FOR EACH ROW EXECUTE FUNCTION "refuse_itinerary_leg_rewrite"();

-- A superseded leg must be named by an immutable rebooking mapping before its
-- transaction commits. Deferred because the event and replacement leg are
-- naturally written after the original leg is marked historical.
CREATE FUNCTION "require_recorded_leg_supersession"()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "ItineraryLeg" WHERE "id" = NEW."id") THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "BookingRebookingLeg" WHERE "fromLegId" = NEW."id"
    ) THEN
        RAISE EXCEPTION
            'Superseded ItineraryLeg % must be recorded by a BookingRebookingLeg.',
            NEW."id";
    END IF;
    IF EXISTS (
        SELECT 1 FROM "SeatAssignment"
        WHERE "legId" = NEW."id" AND "releasedAt" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Superseded ItineraryLeg % cannot retain live seat assignments.',
            NEW."id";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ItineraryLeg_supersession_is_recorded"
    AFTER UPDATE OF "supersededAt" ON "ItineraryLeg"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    WHEN (OLD."supersededAt" IS NULL AND NEW."supersededAt" IS NOT NULL)
    EXECUTE FUNCTION "require_recorded_leg_supersession"();

-- The status row is the booking-wide audit sequence. A rebooking can only be
-- attached to the transition that resolves a disruption, for the same
-- booking, and cannot simultaneously claim a refund.
CREATE FUNCTION "validate_booking_rebooking"()
RETURNS TRIGGER AS $$
DECLARE
    change "BookingStatusChange";
BEGIN
    SELECT * INTO change
    FROM "BookingStatusChange"
    WHERE "id" = NEW."bookingStatusChangeId";

    IF NOT FOUND
       OR change."bookingId" <> NEW."bookingId"
       OR change."from" IS DISTINCT FROM 'DISRUPTED'::"BookingStatus"
       OR change."to" IS DISTINCT FROM 'CONFIRMED'::"BookingStatus"
       OR change."refundCents" IS NOT NULL THEN
        RAISE EXCEPTION
            'BookingRebooking must match one non-refunding DISRUPTED to CONFIRMED status change.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingRebooking_is_consistent"
    BEFORE INSERT ON "BookingRebooking"
    FOR EACH ROW EXECUTE FUNCTION "validate_booking_rebooking"();

-- Both legs remain real rows. The destination must be current and both must
-- occupy the same position in this booking. Because the legs differ and the
-- partial unique index permits only one current row at that position, a current
-- destination also proves the source is historical.
CREATE FUNCTION "validate_booking_rebooking_leg"()
RETURNS TRIGGER AS $$
DECLARE
    event_booking_id INTEGER;
    from_booking_id INTEGER;
    from_sequence INTEGER;
    to_booking_id INTEGER;
    to_sequence INTEGER;
    to_superseded_at TIMESTAMP(3);
BEGIN
    SELECT "bookingId" INTO event_booking_id
    FROM "BookingRebooking"
    WHERE "id" = NEW."rebookingId";
    SELECT "bookingId", "sequence"
        INTO from_booking_id, from_sequence
    FROM "ItineraryLeg" WHERE "id" = NEW."fromLegId";
    SELECT "bookingId", "sequence", "supersededAt"
        INTO to_booking_id, to_sequence, to_superseded_at
    FROM "ItineraryLeg" WHERE "id" = NEW."toLegId";

    IF event_booking_id IS NULL
       OR from_booking_id IS NULL
       OR to_booking_id IS NULL
       OR from_booking_id <> event_booking_id
       OR to_booking_id <> event_booking_id
       OR from_sequence <> to_sequence
       OR to_superseded_at IS NOT NULL THEN
        RAISE EXCEPTION
            'BookingRebookingLeg must map superseded and active legs from the same booking and same itinerary position.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingRebookingLeg_is_consistent"
    BEFORE INSERT ON "BookingRebookingLeg"
    FOR EACH ROW EXECUTE FUNCTION "validate_booking_rebooking_leg"();

-- An event with no leg mapping says a rebooking happened but cannot say what
-- changed. Deferred so a normal transaction can insert the event first.
CREATE FUNCTION "require_rebooking_legs"()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "BookingRebooking" WHERE "id" = NEW."id") THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "BookingRebookingLeg" WHERE "rebookingId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'BookingRebooking % must map at least one itinerary leg.', NEW."id";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "BookingRebooking_has_legs"
    AFTER INSERT ON "BookingRebooking"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "require_rebooking_legs"();

-- A direct mapping or event delete would leave its source leg historical with
-- no record of what replaced it. Deferred so deleting the whole booking remains
-- possible: that cascade also deletes the source leg before this check runs.
CREATE FUNCTION "require_supersession_mapping_after_delete"()
RETURNS TRIGGER AS $$
BEGIN
    -- A replacement row with the same source is not restoration: accepting it
    -- would allow delete-and-reinsert to rewrite the event timestamp or other
    -- audit fields. The only permitted delete is the booking cascade, after
    -- which the source leg no longer exists when this deferred check runs.
    IF EXISTS (
        SELECT 1 FROM "ItineraryLeg" WHERE "id" = OLD."fromLegId"
    ) THEN
        RAISE EXCEPTION
            'BookingRebookingLeg for superseded ItineraryLeg % cannot be deleted directly.',
            OLD."fromLegId";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "BookingRebookingLeg_preserves_supersession"
    AFTER DELETE ON "BookingRebookingLeg"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "require_supersession_mapping_after_delete"();

-- Updates rewrite audit history. Deletes remain available only through the
-- booking cascade, matching BookingStatusChange and test-data cleanup.
CREATE FUNCTION "refuse_rebooking_audit_update"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only and cannot be modified.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingRebooking_is_append_only"
    BEFORE UPDATE ON "BookingRebooking"
    FOR EACH ROW EXECUTE FUNCTION "refuse_rebooking_audit_update"();

CREATE TRIGGER "BookingRebookingLeg_is_append_only"
    BEFORE UPDATE ON "BookingRebookingLeg"
    FOR EACH ROW EXECUTE FUNCTION "refuse_rebooking_audit_update"();
