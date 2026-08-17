-- Record every bulk duration/fare change with the exact before/after values,
-- affected counts, actor and a stable retry key (#83, #237).
--
-- Reversal (there are no automated down migrations):
--   DROP TRIGGER "FlightScheduleTermsChange_is_append_only_delete" ON "FlightScheduleTermsChange";
--   DROP FUNCTION "refuse_schedule_terms_change_delete"();
--   DROP TRIGGER "FlightScheduleTermsChange_is_append_only" ON "FlightScheduleTermsChange";
--   DROP FUNCTION "refuse_schedule_terms_change_update"();
--   DROP TABLE "FlightScheduleTermsChange";

CREATE TABLE "FlightScheduleTermsChange" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "flightScheduleId" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "fromDurationMinutes" INTEGER NOT NULL,
    "toDurationMinutes" INTEGER NOT NULL,
    "fromPriceCents" INTEGER NOT NULL,
    "toPriceCents" INTEGER NOT NULL,
    "updatedOccurrenceCount" INTEGER NOT NULL,
    "protectedOccurrenceCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightScheduleTermsChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FlightScheduleTermsChange_request_nonempty"
        CHECK (length("requestId") > 0),
    CONSTRAINT "FlightScheduleTermsChange_duration_positive"
        CHECK (
            "fromDurationMinutes" > 0
            AND "toDurationMinutes" > 0
            AND "fromDurationMinutes" <= 4320
            AND "toDurationMinutes" <= 4320
        ),
    CONSTRAINT "FlightScheduleTermsChange_price_nonnegative"
        CHECK ("fromPriceCents" >= 0 AND "toPriceCents" >= 0),
    CONSTRAINT "FlightScheduleTermsChange_counts_nonnegative"
        CHECK ("updatedOccurrenceCount" >= 0 AND "protectedOccurrenceCount" >= 0)
);

CREATE UNIQUE INDEX "FlightScheduleTermsChange_requestId_key"
    ON "FlightScheduleTermsChange"("requestId");
CREATE INDEX "FlightScheduleTermsChange_flightScheduleId_createdAt_idx"
    ON "FlightScheduleTermsChange"("flightScheduleId", "createdAt");

ALTER TABLE "FlightScheduleTermsChange"
    ADD CONSTRAINT "FlightScheduleTermsChange_flightScheduleId_fkey"
    FOREIGN KEY ("flightScheduleId") REFERENCES "FlightSchedule"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FlightScheduleTermsChange"
    ADD CONSTRAINT "FlightScheduleTermsChange_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit fields cannot be rewritten. The only permitted update is the foreign
-- key setting actorUserId to null when an account is deleted; the event remains.
CREATE FUNCTION "refuse_schedule_terms_change_update"()
RETURNS TRIGGER AS $$
DECLARE
    forgotten_actor "FlightScheduleTermsChange" := OLD;
BEGIN
    IF OLD."actorUserId" IS NOT NULL AND NEW."actorUserId" IS NULL THEN
        forgotten_actor."actorUserId" := NULL;
        IF NEW IS NOT DISTINCT FROM forgotten_actor THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION
        'FlightScheduleTermsChange is append-only: row % for schedule % cannot be modified.',
        OLD."id", OLD."flightScheduleId";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlightScheduleTermsChange_is_append_only"
    BEFORE UPDATE ON "FlightScheduleTermsChange"
    FOR EACH ROW EXECUTE FUNCTION "refuse_schedule_terms_change_update"();

-- Direct deletion (including delete-and-reinsert) rewrites history. Check in a
-- BEFORE trigger so recreating the same primary key cannot cancel a deferred
-- trigger event. During the foreign-key cascade the parent is already absent
-- from this statement's view, so ordinary schedule deletion remains possible.
CREATE FUNCTION "refuse_schedule_terms_change_delete"()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "FlightSchedule" WHERE "id" = OLD."flightScheduleId"
    ) THEN
        RAISE EXCEPTION
            'FlightScheduleTermsChange % cannot be deleted while schedule % exists.',
            OLD."id", OLD."flightScheduleId";
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlightScheduleTermsChange_is_append_only_delete"
    BEFORE DELETE ON "FlightScheduleTermsChange"
    FOR EACH ROW EXECUTE FUNCTION "refuse_schedule_terms_change_delete"();
