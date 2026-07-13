ALTER TABLE "User"
ADD CONSTRAINT "User_email_canonical_check"
CHECK ("email" IS NULL OR "email" = LOWER(TRIM("email")));
