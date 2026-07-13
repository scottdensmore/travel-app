WITH ranked_tokens AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY "identifier"
      ORDER BY "expires" DESC, "token" DESC
    ) AS rank
  FROM "VerificationToken"
)
DELETE FROM "VerificationToken" token
USING ranked_tokens ranked
WHERE token.ctid = ranked.ctid
  AND ranked.rank > 1;

CREATE UNIQUE INDEX "VerificationToken_identifier_key"
ON "VerificationToken"("identifier");

CREATE INDEX "VerificationToken_expires_idx"
ON "VerificationToken"("expires");
