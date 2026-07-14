-- Existing rows belong to the pre-production demo dataset. Purge their
-- plaintext identity fields during the migration rather than copying
-- sensitive values without access to the runtime encryption key.
ALTER TABLE "Passenger"
    DROP COLUMN "dateOfBirth",
    DROP COLUMN "passportNumber",
    ADD COLUMN "dateOfBirthEncrypted" TEXT,
    ADD COLUMN "passportNumberEncrypted" TEXT,
    ADD COLUMN "sensitiveDataExpiresAt" TIMESTAMP(3),
    ADD COLUMN "sensitiveDataDeletedAt" TIMESTAMP(3);

UPDATE "Passenger"
SET "sensitiveDataDeletedAt" = CURRENT_TIMESTAMP;

CREATE INDEX "Passenger_sensitiveDataExpiresAt_idx"
ON "Passenger"("sensitiveDataExpiresAt");
