# Transparent Fare Breakdown Plan

1. **Pricing Model Extension**
   - Write unit tests in `__tests__/lib/bookingPricing.test.ts` for new breakdown logic.
   - Implement `calculateFareBreakdown` in `lib/bookingPricing.ts` taking into account fixed fees and taxes.

2. **UI Integration**
   - In `components/ui/BookingCheckoutWizard.tsx`, locate Steps 4 and 5.
   - Build a collapsible accordion/disclosure component for "Taxes, Fees & Charges Breakdown".
   - Iterate over passengers and legs, calling `calculateFareBreakdown`.
   - Add component tests in `__tests__/components/BookingCheckoutWizard.test.tsx`.

3. **Email Template Integration**
   - Modify `lib/travelDocumentEmail.ts` to include the breakdown in both HTML and plain text emails.
   - Add tests to `__tests__/lib/travelDocumentEmail.test.ts`.

4. **Verification**
   - Run linter and tsc.
   - Run all tests.
   - Commit cleanly.
