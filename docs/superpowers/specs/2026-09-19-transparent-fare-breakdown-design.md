# Transparent Fare Breakdown Design

## Objective
Provide a transparent fare breakdown for each commercial flight, showing base airfare, government taxes, airport passenger facility charges (PFC), and aviation security fees. It must sum up perfectly to the exact `totalPriceCents` without any rounding drift.

## Details
- PFC: $4.50 (450 cents) per passenger per leg
- Security Fee: $5.60 (560 cents) per passenger per leg
- Government Tax: 7.5% excise on base airfare
- Base Airfare: The remainder such that `Base Airfare + Gov Tax + PFC + Security Fee === Flight Price`
- Ancillary/Baggage: Handled separately, simply added to total breakdown.
- Invariant: No rounding gaps. `Base Airfare = Math.round((Flight Price - PFC - Security Fee) / 1.075)` and `Gov Tax = (Flight Price - PFC - Security Fee) - Base Airfare`.

## Components Affected
- `lib/bookingPricing.ts` (calculateFareBreakdown)
- `components/ui/BookingCheckoutWizard.tsx` (UI integration, collapsible accordion)
- `lib/travelDocumentEmail.ts` (email template integration)
