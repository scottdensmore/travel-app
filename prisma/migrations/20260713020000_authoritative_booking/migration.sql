-- Existing demo bookings predate idempotency keys, so the column remains
-- nullable while all new booking requests require one at the service boundary.
ALTER TABLE "Booking" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Booking_userId_idempotencyKey_key"
ON "Booking"("userId", "idempotencyKey");
