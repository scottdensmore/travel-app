-- Preserve schedule term-change history when its template is permanently
-- removed, and record the deleted template's exact before-state (#83).
--
-- Reversal (there are no automated down migrations):
--   Refuse reversal while any FlightScheduleDeletion row exists. Then drop the
--   deletion and terms-subject triggers/functions/table, restore the prior
--   cascade-aware refuse_schedule_terms_change_delete() body, then restore the
--   terms FK to ON DELETE CASCADE.

ALTER TABLE "FlightScheduleTermsChange"
    DROP CONSTRAINT "FlightScheduleTermsChange_flightScheduleId_fkey";

CREATE FUNCTION "require_schedule_terms_change_subject"()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "FlightSchedule" WHERE "id" = NEW."flightScheduleId"
    ) THEN
        RAISE EXCEPTION
            'FlightScheduleTermsChange must name an existing schedule: %.',
            NEW."flightScheduleId";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlightScheduleTermsChange_requires_subject"
    BEFORE INSERT ON "FlightScheduleTermsChange"
    FOR EACH ROW EXECUTE FUNCTION "require_schedule_terms_change_subject"();

-- The terms audit now outlives its subject, so the cascade exception in the
-- original delete guard is no longer valid. Audit cleanup in disposable test
-- databases must explicitly disable triggers for the exact rows it owns.
CREATE OR REPLACE FUNCTION "refuse_schedule_terms_change_delete"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'FlightScheduleTermsChange % cannot be deleted.',
        OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "FlightScheduleDeletion" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "flightScheduleId" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "flightNumber" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "daysOfWeek" INTEGER[] NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "firstClassRows" INTEGER,
    "businessRows" INTEGER,
    "premiumEconomyRows" INTEGER,
    "economyRows" INTEGER,
    "seatPattern" TEXT,
    "occurrenceCount" INTEGER NOT NULL,
    "protectedOccurrenceCount" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightScheduleDeletion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FlightScheduleDeletion_request_nonempty" CHECK (length("requestId") > 0),
    CONSTRAINT "FlightScheduleDeletion_schedule_positive" CHECK ("flightScheduleId" > 0),
    CONSTRAINT "FlightScheduleDeletion_duration_positive" CHECK (
        "durationMinutes" > 0 AND "durationMinutes" <= 4320
    ),
    CONSTRAINT "FlightScheduleDeletion_price_nonnegative" CHECK ("priceCents" >= 0),
    CONSTRAINT "FlightScheduleDeletion_counts_valid" CHECK (
        "occurrenceCount" >= 0
        AND "protectedOccurrenceCount" >= 0
        AND "protectedOccurrenceCount" <= "occurrenceCount"
    )
);

CREATE UNIQUE INDEX "FlightScheduleDeletion_requestId_key"
    ON "FlightScheduleDeletion"("requestId");
CREATE UNIQUE INDEX "FlightScheduleDeletion_flightScheduleId_key"
    ON "FlightScheduleDeletion"("flightScheduleId");
CREATE INDEX "FlightScheduleDeletion_deletedAt_idx"
    ON "FlightScheduleDeletion"("deletedAt");

ALTER TABLE "FlightScheduleDeletion"
    ADD CONSTRAINT "FlightScheduleDeletion_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "require_schedule_deletion_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
    -- The database, not a caller, authors when this immutable receipt began.
    NEW."deletedAt" := statement_timestamp();
    IF NOT EXISTS (
        SELECT 1
        FROM "FlightSchedule" AS schedule
        WHERE schedule."id" = NEW."flightScheduleId"
          AND schedule."isActive" IS FALSE
          AND schedule."flightNumber" IS NOT DISTINCT FROM NEW."flightNumber"
          AND schedule."airline" IS NOT DISTINCT FROM NEW."airline"
          AND schedule."from" IS NOT DISTINCT FROM NEW."from"
          AND schedule."to" IS NOT DISTINCT FROM NEW."to"
          AND schedule."departureTime" IS NOT DISTINCT FROM NEW."departureTime"
          AND schedule."durationMinutes" IS NOT DISTINCT FROM NEW."durationMinutes"
          AND schedule."daysOfWeek" IS NOT DISTINCT FROM NEW."daysOfWeek"
          AND schedule."priceCents" IS NOT DISTINCT FROM NEW."priceCents"
          AND schedule."firstClassRows" IS NOT DISTINCT FROM NEW."firstClassRows"
          AND schedule."businessRows" IS NOT DISTINCT FROM NEW."businessRows"
          AND schedule."premiumEconomyRows" IS NOT DISTINCT FROM NEW."premiumEconomyRows"
          AND schedule."economyRows" IS NOT DISTINCT FROM NEW."economyRows"
          AND schedule."seatPattern" IS NOT DISTINCT FROM NEW."seatPattern"
    ) THEN
        RAISE EXCEPTION
            'FlightScheduleDeletion must exactly snapshot inactive schedule %.',
            NEW."flightScheduleId";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlightScheduleDeletion_matches_inactive_schedule"
    BEFORE INSERT ON "FlightScheduleDeletion"
    FOR EACH ROW EXECUTE FUNCTION "require_schedule_deletion_snapshot"();

CREATE FUNCTION "refuse_schedule_deletion_update"()
RETURNS TRIGGER AS $$
DECLARE
    forgotten_actor "FlightScheduleDeletion" := OLD;
BEGIN
    IF OLD."actorUserId" IS NOT NULL AND NEW."actorUserId" IS NULL THEN
        forgotten_actor."actorUserId" := NULL;
        IF NEW IS NOT DISTINCT FROM forgotten_actor THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION
        'FlightScheduleDeletion is append-only: row % cannot be modified.',
        OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlightScheduleDeletion_is_append_only"
    BEFORE UPDATE ON "FlightScheduleDeletion"
    FOR EACH ROW EXECUTE FUNCTION "refuse_schedule_deletion_update"();

CREATE FUNCTION "refuse_schedule_deletion_delete"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'FlightScheduleDeletion is append-only: row % cannot be deleted.',
        OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlightScheduleDeletion_is_append_only_delete"
    BEFORE DELETE ON "FlightScheduleDeletion"
    FOR EACH ROW EXECUTE FUNCTION "refuse_schedule_deletion_delete"();
