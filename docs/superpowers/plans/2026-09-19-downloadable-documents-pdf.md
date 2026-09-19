# Downloadable Documents Implementation Plan
## Issue #352: feat(documents): downloadable e-ticket and invoice/receipt PDF generation

### Step 1: Dependencies
- Run `npm install pdfkit` and `npm install -D @types/pdfkit`.

### Step 2: PDF Generator (lib/documents/pdfGenerator.ts)
- Write tests in `__tests__/lib/pdfGenerator.test.ts`.
- Implement `generateETicketPDF(booking)` and `generateInvoicePDF(booking)` using `pdfkit`.

### Step 3: API Endpoints (app/api/documents)
- Write tests in `__tests__/app/api/documents.test.ts`.
- Implement `app/api/documents/e-ticket/[bookingId]/route.ts`.
- Implement `app/api/documents/invoice/[bookingId]/route.ts`.

### Step 4: UI Integration
- Write tests and modify `components/ui/BookingCheckoutWizard.tsx` (Step 5).
- Write tests and modify `components/ui/ProfileClient.tsx`.

### Step 5: Verification
- Run `npx tsc --noEmit`.
- Run `npm run lint`.
- Run `npm run test:unit`.
- Commit.
