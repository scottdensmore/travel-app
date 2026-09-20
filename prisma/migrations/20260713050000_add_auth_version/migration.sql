SET LOCAL lock_timeout = '3s';

ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
