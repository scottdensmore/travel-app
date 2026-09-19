# Downloadable Documents PDF Design
## Issue #352: feat(documents): downloadable e-ticket and invoice/receipt PDF generation

### 1. Requirements
* Generate Branded PDFs: E-Ticket and Tax Invoice/Receipt.
* Secure API Endpoints:
  * `/api/documents/e-ticket/[bookingId]`
  * `/api/documents/invoice/[bookingId]`
* Authorization: Only booking owner or `ADMIN` can download.
* UI Integration: Add download buttons on Checkout Wizard Step 5 and Profile Booking Cards.

### 2. Architecture
* `lib/documents/pdfGenerator.ts`: Uses `pdfkit` to draw vector PDF streams.
* API Endpoints: Fetch booking details, check `getServerSession(authOptions)`, generate PDF, and stream it back with `Content-Disposition: attachment`.
* Frontend: Simple `window.open` or `<a>` download links to the endpoints.
