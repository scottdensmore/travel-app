ALTER TABLE "Passenger"
ADD CONSTRAINT "Passenger_sensitive_data_state_check"
CHECK (
    (
        "dateOfBirthEncrypted" IS NOT NULL
        AND "passportNumberEncrypted" IS NOT NULL
        AND "sensitiveDataExpiresAt" IS NOT NULL
        AND "sensitiveDataDeletedAt" IS NULL
    )
    OR (
        "dateOfBirthEncrypted" IS NULL
        AND "passportNumberEncrypted" IS NULL
        AND "sensitiveDataDeletedAt" IS NOT NULL
    )
);
