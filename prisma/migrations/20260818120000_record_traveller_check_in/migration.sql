-- Record that a traveller has checked in for one leg (#77).
--
-- On `SeatAssignment` rather than in a table of its own, because that row is
-- already exactly "this traveller, on this leg": it carries a unique
-- ("passengerId", "legId"), which is the key a check-in would need, and a seat
-- change updates it in place rather than inserting a second row, so a check-in
-- survives one. A separate table would duplicate that key and could then
-- disagree with it -- the hazard #73 removed from the route columns.
--
-- Deliberately not constrained against "releasedAt". A traveller who checks in
-- and then cancels has both set, and that is the truth of what happened; a CHECK
-- forbidding the pair would make the cancellation fail rather than the check-in
-- invalid. Product code reads a live seat's check-in and ignores a released
-- one's, which is a question about now, not about history.
--
-- TIMESTAMPTZ, unlike the older "releasedAt" beside it. This is an instant the
-- server stamps and later compares against departure instants, which have been
-- TIMESTAMPTZ since #84; a bare TIMESTAMP would be a wall clock with no zone and
-- would be wrong by the server's offset in exactly the comparison that matters.
-- Converting "releasedAt" is a separate change with its own backfill and is not
-- in this slice's scope.
--
-- To reverse:
--
--     BEGIN;
--     ALTER TABLE "SeatAssignment" DROP COLUMN "checkedInAt";
--     DELETE FROM _prisma_migrations
--       WHERE migration_name = '20260818120000_record_traveller_check_in';
--     COMMIT;
--
-- Reversal loses which travellers had checked in, and nothing else: no other
-- column, index or constraint is derived from it.

SET LOCAL lock_timeout = '3s';

ALTER TABLE "SeatAssignment" ADD COLUMN "checkedInAt" TIMESTAMPTZ(3);
