DO $$
BEGIN
    IF EXISTS (
        SELECT LOWER(TRIM("email"))
        FROM "User"
        WHERE "email" IS NOT NULL
        GROUP BY LOWER(TRIM("email"))
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot normalize user emails because case-variant duplicates exist';
    END IF;
END $$;

UPDATE "User"
SET "email" = LOWER(TRIM("email"))
WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX "User_email_normalized_key"
ON "User" (LOWER("email"))
WHERE "email" IS NOT NULL;

CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
