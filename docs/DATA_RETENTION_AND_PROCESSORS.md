# Data Retention Policies and Third-Party Processors

This document details the categories of personal data collected and stored by the Travel App platform, the retention schedules governing their lifecycle, the anonymization and deletion workflows implemented under GDPR/CCPA compliance, and the third-party sub-processors engaged in processing customer information.

---

## 1. Personal Data Stored

The platform collects and stores personal data strictly necessary for flight reservations, identity verification, flight operations, passenger assistance, and financial accounting:

### 1.1 User Accounts
- **Profile Data**: Full name, email address, profile avatar image URL (or data URL), preferred IANA account timezone, and account role (`CUSTOMER`, `STAFF`, `ADMIN`).
- **Authentication Data**: Cryptographic password hashes (managed via standard hashing algorithms), OAuth provider identifiers and account links, session records, and token invalidation counters (`authVersion`).

### 1.2 Passenger Profiles
- **Basic Travel Data**: Passenger first name, last name, and gender.
- **Verification Attestation**: `documentsConfirmedAt` timestamp recording document validation at check-in (recording attestation without persisting or exposing plaintext documents on customer projections).

### 1.3 Restricted & Regulatory Passenger Security Data (Encrypted-at-Rest)
To protect passenger confidentiality and comply with aviation security standards (TSA Secure Flight / PreCheck), sensitive identity credentials are stored exclusively as versioned AES-256-GCM ciphertext with authenticated context binding:
- **Date of Birth (`dateOfBirthEncrypted`)**: Encrypted with unique 12-byte random IV and bound to the passenger record.
- **Passport Number (`passportNumberEncrypted`)**: Encrypted with unique 12-byte random IV.
- **Known Traveler Number (`ktnEncrypted`)**: TSA PreCheck / Global Entry credential; validated against 9-character alphanumeric format and encrypted at rest.
- **Redress Number (`redressNumberEncrypted`)**: Department of Homeland Security travel screening resolution number; validated against 7-digit numeric format and encrypted at rest.
- **Emergency Contact (`emergencyContactEncrypted`)**: Encrypted JSON payload containing contact full name, relationship to traveler, and emergency telephone number.

### 1.4 Bookings & Travel Records
- **Booking Core**: 6-character alphanumeric booking reference (PNR), booking date, booking status (`CONFIRMED`, `CANCELLED`, `DISRUPTED`), total price, and currency.
- **Contact Details**: Contact email address and telephone number associated with the reservation.
- **Itinerary & Ancillaries**: Flight segments, flight numbers, departure and arrival airports/times, seat assignments, baggage allowances (carry-on, checked bags), priority boarding, and special assistance requests.

### 1.5 Audit & Operational Records
- **Booking Status Changes (`BookingStatusChange`)**: Complete audit log of booking state transitions, including the triggering actor, reason, timestamp, and previous/next states.
- **Customer Support Notes (`BookingNote`)**: Internal operational notes recorded by customer service staff to assist travelers.
- **Schedule Management Audit (`FlightScheduleTermsChange`, `FlightScheduleDeletion`)**: Administrative audit trails recording changes or cancellations of flight schedules with mandatory staff rationale.
- **Financial Transaction Logs (`PaymentAttempt`, `PaymentRefund`, `PaymentWebhookEvent`)**: Idempotent records of authorization, capture, refund attempts, and verified Stripe webhook events.

---

## 2. Retention Policies and Deletion Workflows

Data retention is balanced between customer privacy rights (data minimization) and statutory obligations (tax, financial, and aviation safety regulations).

### 2.1 Retention Schedules

| Data Category | Retention Period | Justification |
| :--- | :--- | :--- |
| **Financial & Booking Records** | **7 Years** | Statutory compliance with commercial accounting, tax audit, and financial fraud prevention regulations. |
| **Restricted Passenger Identity Data** (Passport, DOB, KTN, Redress, Emergency Contact) | **30 Days post-departure** | Operational necessity during travel window; automatically purged thereafter to minimize exposure. |
| **Active User Accounts** | Duration of active relationship | Maintenance of booking history, profile preferences, and loyalty points. |
| **Inactive Accounts** | Periodic review / cleanup | Accounts with no login or booking activity over extended periods are flagged for notification and deactivation. |
| **Audit Logs** | Up to 7 years | Security forensics, compliance verification, and dispute resolution. |

### 2.2 Automated Sensitive Data Purging
The application executes automated purging jobs (`purgeExpiredPassengerData`) at application startup and on hourly schedules:
- Targets all passenger records where `sensitiveDataExpiresAt <= NOW()` and `sensitiveDataDeletedAt IS NULL`.
- Irreversibly nullifies `dateOfBirthEncrypted`, `passportNumberEncrypted`, `ktnEncrypted`, `redressNumberEncrypted`, and `emergencyContactEncrypted`.
- Marks `sensitiveDataDeletedAt` with the deletion timestamp while preserving historical non-sensitive booking, leg, and seat records.

### 2.3 Account Deletion & Right-to-be-Forgotten Workflow (#367)
Customers can initiate self-service account deletion via `/profile/privacy`. To uphold data protection rights while maintaining financial compliance, the system implements a strict multi-stage workflow:
1. **Pre-Flight Travel Guard**:
   - Rejects deletion requests if the user has active upcoming flights on `CONFIRMED` or `DISRUPTED` bookings. The traveler must complete or cancel travel before deleting their account.
2. **Re-Authentication**:
   - Requires credential confirmation prior to executing the irreversible deletion action.
3. **Restricted Data Purge**:
   - Invokes `purgePassengerDataForUser` to immediately nullify all encrypted identity fields (passport, DOB, KTN, Redress, emergency contacts) associated with the user's bookings.
4. **Anonymization of PII**:
   - To comply with the 7-year financial record retention rule, historical bookings cannot be hard-deleted from the ledger. Instead, PII is irreversibly anonymized:
     - User full name is scrubbed.
     - Email address is overwritten with a tombstone address (`deleted-[userId]@privacy.invalid`).
     - Profile picture/cover image is removed.
     - Password hashes, session tokens, and OAuth accounts are deleted.
     - Passenger names on historical bookings are updated to `'Anonymized Passenger'`.
5. **Session Revocation**:
   - Increments `authVersion`, invalidating all active JSON Web Tokens (JWT) and terminating open sessions across all devices.

---

## 3. Third-Party Processors

The platform engages trusted third-party service providers to deliver specialized functionality. All processors are bound by strict data protection standards:

### 3.1 PostgreSQL Database
- **Role**: Primary transactional datastore for relational application data.
- **Data Shared**: Account information, encrypted passenger records, booking details, and audit entries.
- **Security Safeguards**: Encryption-at-rest for storage volumes, TLS for all client connections, and application-layer AES-256-GCM encryption for restricted passenger credentials.

### 3.2 Stripe
- **Role**: Payment gateway and merchant processing.
- **Data Shared**: Transaction amounts, currency, checkout identifiers, and customer billing details.
- **Security Safeguards**:
  - PCI-DSS Level 1 certified service provider.
  - Credit and debit card credentials are collected directly via Stripe Elements (hosted fields/iFrames) in the customer's browser. Plaintext card numbers never touch or transit Travel App servers or databases.
  - Server stores only opaque provider intent IDs (`providerIntentId`), refund references, and webhook idempotency signatures.

### 3.3 OpenStreetMap Nominatim
- **Role**: Geocoding service for travel guides and city coordinate lookup.
- **Data Shared**: City name and Country name strings only.
- **Privacy Safeguards**:
  - Strictly limited to public geographical search queries (e.g. `cityName`, `countryName`).
  - **Zero PII transmission**: No user identifiers, booking data, passenger data, or customer IP addresses are forwarded to Nominatim.

### 3.4 Email Notification Provider
- **Role**: Transactional email delivery service (SMTP / transactional email gateway).
- **Data Shared**: Recipient email address, customer first name, and relevant travel itinerary or booking confirmation details.
- **Purpose**: Delivery of essential service messages, including e-tickets, booking receipts, flight disruption notifications, and password reset requests. No marketing or tracking pixels are included in operational travel alerts.
