# Staff account protection policy

## Access requirements

Every account with the `ADMIN` role must authenticate with both its password
and a six-digit time-based one-time password (TOTP). Password-only staff
sessions may access only the authenticator enrollment flow. Admin pages,
navigation, and server mutations require a session whose staff factor was
verified.

Staff authentication proof has a maximum lifetime of eight hours. The user
must sign in again with both factors after that window. Each accepted TOTP time
step is recorded atomically and cannot be replayed, including by a concurrent
request.

TOTP improves resistance to password theft but is not phishing-resistant.
Phishing-resistant authenticators, scoped staff permissions, and additional
confirmation for privileged operations are tracked in
[#85](https://github.com/scottdensmore/travel-app/issues/85), P4.3.

## Enrollment

1. Promote the verified account to `ADMIN` through an authorized operational
   process.
2. The staff member signs in with their password and is redirected to the
   enrollment page.
3. They generate a setup key, add it to an authenticator app, and confirm a
   current code.
4. Confirmation records the enrollment timestamp and increments
   `authVersion`, invalidating the limited enrollment session.
5. They sign in again with their password and a current code before receiving
   admin access.

The setup secret is encrypted before database storage, even while enrollment
is pending. Do not transmit or record the manual setup key in tickets, chat,
logs, analytics, or screenshots.

## Secret storage and rotation

`STAFF_MFA_ENCRYPTION_KEYS` is a comma-separated key ring in
`key-id:base64-key` form. Each key must decode to exactly 32 random bytes. The
first entry is active for writes; retained entries decrypt older ciphertext.
Use a key ring that is separate from `NEXTAUTH_SECRET`, passenger-data keys,
database credentials, and other application secrets.

To rotate the encryption key:

1. Generate a random 32-byte key with `openssl rand -base64 32`.
2. Add it as the first entry with a new key ID while retaining the previous
   entries.
3. Deploy the new key ring. Successful staff sign-ins re-encrypt their secret
   with the active key.
4. Confirm that no stored staff secret uses the retired key ID before removing
   that key from every deployment.

Losing every key that can decrypt a staff secret requires MFA reset for the
affected accounts.

## Reset and recovery

There is intentionally no self-service staff-factor reset. An authorized
operator must verify the staff member through the organization's documented
identity process, record who approved and performed the reset, then atomically:

- clear `staffMfaSecretEncrypted`, `staffMfaEnrolledAt`, and
  `staffMfaLastUsedStep`; and
- increment `authVersion` to invalidate existing sessions.

The staff member then repeats enrollment. Password reset does not clear the
staff factor. Do not bypass the second factor or temporarily downgrade an
account as a recovery shortcut. If immediate access is required during an
incident, use a separately governed break-glass account and review its activity
afterward.
