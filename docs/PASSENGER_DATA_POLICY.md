# Passenger Identity Data Policy

Passport numbers and dates of birth are restricted identity data. They are
collected only to create a booking and must not be reused for analytics,
marketing, or routine customer-support work.

## Storage and encryption

- The database stores these fields only as versioned AES-256-GCM ciphertext.
  A fresh 12-byte random IV protects every value, and authenticated context
  binds each ciphertext to its passenger record and field.
- `PASSENGER_DATA_ENCRYPTION_KEYS` is a comma-separated key ring in
  `key-id:base64-key` form. The first key encrypts new values; retained keys
  decrypt older values during rotation. Key IDs use only letters, numbers, and
  hyphens; every key must be 32 random bytes.
- Keys must be generated with a cryptographically secure generator and stored
  in the deployment secret manager, separately from the database. They must
  never be committed, logged, or baked into an image.
- A suspected exposure requires an immediate new active key, re-encryption of
  retained records, revocation of the affected key after old backups age out,
  and an incident review.
- On startup and hourly, the application re-encrypts bounded batches written
  with retained keys using the active key. Remove a retired key only after no
  live records use it and every backup that requires it has aged out.

## Access and redaction

- Booking creation is the only normal write path. Plaintext exists only in the
  request-scoped server process long enough to validate and encrypt it.
- Customer profiles receive passenger names and travel-assignment fields, but
  never encrypted or plaintext passport numbers or dates of birth.
- Routine administration manifests use the same safe projection. Access to an
  admin route alone is not sufficient to reveal restricted identity data.
- Booking action results, logs, errors, notifications, analytics, and routine
  API responses must not contain either plaintext or ciphertext values.
- Any future operational reveal flow requires a separately authorized,
  audited, purpose-limited action with step-up staff authentication.
- Check-in confirms these details by attestation, never by display. The customer
  is asked to confirm that the names, dates of birth and passport details given
  when the booking was made are correct; the application shows none of those
  values back and accepts no replacement for them, because booking creation
  remains the only normal write path. `Passenger.documentsConfirmedAt` records
  only that the confirmation happened, which is why it is safe on a customer
  projection where the fields it attests to are not. A customer whose details are
  wrong is directed to contact the airline rather than to correct them here.

## Retention and deletion

- Restricted identity data expires 30 days after scheduled departure. The
  application purges expired ciphertext at startup and hourly while retaining
  non-sensitive booking, passenger, and seat history.
- A verified customer erasure request can call the server-only
  `purgePassengerDataForUser` operation immediately. The customer-facing
  export/deletion workflow remains tracked separately under
  [#89](https://github.com/scottdensmore/travel-app/issues/89), P5.3.
- Deleting a booking deletes its passenger rows through the existing database
  cascade. Database backups follow the deployment backup-retention policy and
  must age out before a retired decryption key is destroyed.
- The migration deliberately purges identity values from pre-production demo
  rows because migration tooling must never receive the runtime encryption
  key. Bookings and seat assignments remain intact.

## Verification

Automated checks cover authenticated encryption, unique IVs, tamper detection,
key-ring validation, retention purging, safe view projections, and removal of
plaintext schema columns. Browser coverage confirms routine staff journeys do
not expose restricted identity data.
