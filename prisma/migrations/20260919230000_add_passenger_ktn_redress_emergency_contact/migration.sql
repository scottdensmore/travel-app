SET LOCAL lock_timeout = '3s';

-- AlterTable
ALTER TABLE "Passenger"
    ADD COLUMN "ktnEncrypted" TEXT,
    ADD COLUMN "redressNumberEncrypted" TEXT,
    ADD COLUMN "emergencyContactEncrypted" TEXT;
