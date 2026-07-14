ALTER TABLE "User"
    ADD COLUMN "staffMfaSecretEncrypted" TEXT,
    ADD COLUMN "staffMfaEnrolledAt" TIMESTAMP(3),
    ADD COLUMN "staffMfaLastUsedStep" INTEGER;

ALTER TABLE "User"
ADD CONSTRAINT "User_staff_mfa_state_check"
CHECK (
    (
        "staffMfaEnrolledAt" IS NULL
        AND "staffMfaLastUsedStep" IS NULL
    )
    OR (
        "staffMfaSecretEncrypted" IS NOT NULL
        AND "staffMfaEnrolledAt" IS NOT NULL
    )
);
