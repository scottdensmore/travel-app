# Security Policy

## Secrets and configuration

- Keep local secrets in `.env`; never commit that file or copy it into a
  container image.
- Use `.env.example` only as a list of required settings. It must contain
  placeholders or local-only values, never production credentials.
- Inject `DATABASE_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` through the
  runtime environment in deployed environments.
- Generate `NEXTAUTH_SECRET` with a cryptographically secure generator and use
  at least 32 characters.
- Local development may use `AUTH_TRUSTED_PROXY_HOPS=0`. Production requires a
  value from 1 through 5 and a trusted ingress that sanitizes
  `X-Forwarded-For`. Set it to the exact number of trusted right-most proxy
  entries. Requests with incomplete chains fail closed.
- The recommended Compose deployment exposes only its bundled proxy. That
  proxy replaces client-provided `X-Forwarded-For` content with the connecting
  address, and the app trusts exactly that one proxy hop. For other deployment
  topologies, every trusted ingress must overwrite or safely append the header
  according to the configured hop count; the app must not be directly
  reachable around those ingresses.
- Store deployment secrets in the hosting platform's secret manager and limit
  access to the people and workloads that require them.
- Generate each `PASSENGER_DATA_ENCRYPTION_KEYS` entry as a random 32-byte key,
  keep it separate from the database, and follow the access, rotation,
  retention, and deletion rules in
  [docs/PASSENGER_DATA_POLICY.md](docs/PASSENGER_DATA_POLICY.md).
- Generate each `STAFF_MFA_ENCRYPTION_KEYS` entry as a separate random 32-byte
  key and keep it outside the database. Staff authenticator enrollment,
  session limits, replay protection, reset, and rotation requirements are in
  [docs/STAFF_ACCOUNT_POLICY.md](docs/STAFF_ACCOUNT_POLICY.md).
- Set `AUTH_EMAIL_PROVIDER=postmark`, configure `AUTH_EMAIL_FROM` and
  `AUTH_EMAIL_API_URL=https://api.postmarkapp.com/email`, and inject
  `AUTH_EMAIL_API_TOKEN` through the secret manager for deployed transactional
  delivery. Use an `https://` `NEXTAUTH_URL` for the public application origin.
  Startup and delivery reject plaintext app origins and plaintext or
  non-Postmark endpoints.
  The adapter does not add an SMTP client dependency.
- The Compose Mailpit inbox is a local testing aid. Its web/API port binds only
  to loopback and its SMTP port is not published; do not deploy Mailpit as a
  public or production mailbox.

The application validates required server settings during Node.js startup. A
missing or malformed setting prevents startup instead of allowing a partially
configured deployment.

Authentication throttles store only keyed digests of email/IP identifiers.
Every throttle operation deletes a bounded batch of expired rows so attacker-
controlled identifiers are not retained indefinitely.

Every `ADMIN` session requires a password and a verified TOTP code. A new staff
member receives only an enrollment session until setup is confirmed; admin
pages and mutations independently reject that limited session. Staff proof
expires after eight hours, and a TOTP time step can be consumed only once.

Email verification and password reset tokens are random, single-use, scoped
to one purpose, and stored only as SHA-256 digests. Verification tokens expire
after 24 hours; reset tokens expire after 1 hour. Expired rows are pruned in
indexed, bounded batches at startup, hourly, and during token issuance.
Delivered links place the bearer
token in a URL fragment, which is never sent in an HTTP request; the client
reads and immediately removes the fragment. Global no-referrer policy and the
ingress's query-free access-log format provide defense in depth. Do not log
raw tokens or put them in email subjects.

## Responding to an image that contains secrets

If an image containing `.env` or another secret is published, deleting the
image is not sufficient. Treat every value in that image as exposed.

1. Restrict or remove access to the affected image and record its registry,
   repository, digest, tags, and deployment history.
2. **Rotate exposed secrets** at their source, including the database password,
   `NEXTAUTH_SECRET`, and any other credential present in the image.
3. Revoke old credentials and invalidate active sessions when the rotated value
   can authenticate a user or service.
4. Review registry, deployment, authentication, and database audit logs for
   unexpected access.
5. **Rebuild and redeploy** from a clean commit using newly issued secrets
   injected only at runtime.
6. Verify the replacement image with
   `scripts/verify-container-secrets.sh IMAGE` before promotion.
7. Record the incident, impact assessment, remediation, and follow-up actions.

## Reporting a vulnerability

Do not open a public issue containing credentials, personal data, or exploit
details. Contact the repository owner privately with the affected component,
reproduction steps, impact, and any suggested mitigation.
