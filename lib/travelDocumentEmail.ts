type EmailProvider = 'mailpit' | 'postmark';

function requireSetting(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing email setting: ${name}`);
    return value;
}

function provider(): EmailProvider {
    const value = requireSetting('AUTH_EMAIL_PROVIDER');
    if (value !== 'mailpit' && value !== 'postmark') {
        throw new Error('AUTH_EMAIL_PROVIDER must be mailpit or postmark');
    }
    return value;
}

function mailpitSender(value: string): { Email: string; Name?: string } {
    const namedAddress = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    if (namedAddress) {
        return {
            Email: namedAddress[2].trim(),
            ...(namedAddress[1].trim() ? { Name: namedAddress[1].trim() } : {}),
        };
    }
    return { Email: value };
}

export interface TravelDocumentPassenger {
    name: string;
    seat: string;
    cabin: string;
    ancillaries?: Array<{ type: string; priceCents?: number }>;
    bagCount?: number;
    priorityBoarding?: boolean;
    boardingGroup?: string;
    fareBreakdown?: import('./bookingPricing').FareBreakdown;
    ancillaryTotalCents?: number;
}

export interface TravelDocumentEmailInput {
    to: string;
    bookingReference: string;
    airline: string;
    flightNumber: string;
    from: string;
    toDestination: string;
    departureReadable: string;
    passengers: TravelDocumentPassenger[];
}

export function formatTravelDocumentsEmailText(input: TravelDocumentEmailInput): string {
    const passengerLines = input.passengers
        .map((p, index) => {
            const bagCount = p.bagCount !== undefined
                ? p.bagCount
                : (p.ancillaries ? p.ancillaries.filter(a => a.type.startsWith('CHECKED_BAG')).length : 0);
            const isPriority = p.priorityBoarding ?? (
                Boolean(p.ancillaries?.some(a => a.type === 'PRIORITY_BOARDING')) ||
                p.cabin.toUpperCase().includes('BUSINESS') ||
                p.cabin.toUpperCase().includes('FIRST')
            );
            const group = p.boardingGroup ?? (isPriority ? 'GROUP 1' : 'GROUP 3');
            const lines = [
                `Passenger ${index + 1}: ${p.name}`,
                `Seat: ${p.seat}`,
                `Cabin: ${p.cabin}`,
                `Boarding Group: ${group}${isPriority ? ' (PRIORITY BOARDING)' : ''}`,
                `BAGS: ${bagCount}`,
            ];
            const fb = p.fareBreakdown;
            const anc = p.ancillaryTotalCents;
            if (fb) {
                const formatPrice = (cents: number) => {
                    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
                };
                lines.push('');
                lines.push('--- Fare Breakdown ---');
                lines.push(`Base Airfare: ${formatPrice(fb.baseAirfareCents)}`);
                lines.push(`Government Tax (7.5%): ${formatPrice(fb.governmentTaxCents)}`);
                lines.push(`Passenger Facility Charge: ${formatPrice(fb.pfcCents)}`);
                lines.push(`Security Service Fee: ${formatPrice(fb.securityFeeCents)}`);
                if (anc) {
                    lines.push(`Baggage & Extras: ${formatPrice(anc)}`);
                }
            }
            return lines.join('\n');
        })
        .join('\n\n');

    return [
        `Here are your travel documents for flight ${input.flightNumber}.`,
        '',
        `Confirmation Reference: ${input.bookingReference}`,
        `Airline: ${input.airline}`,
        `Flight: ${input.flightNumber}`,
        `Route: ${input.from} to ${input.toDestination}`,
        `Departure: ${input.departureReadable}`,
        '',
        'Passengers and Seat Assignments:',
        passengerLines,
        '',
        'Please arrive at the airport with valid photo identification.',
        'Thank you for flying with Mona Airways.',
    ].join('\n');
}

export async function sendTravelDocumentsEmail(input: TravelDocumentEmailInput): Promise<void> {
    const text = formatTravelDocumentsEmailText(input);
    const subject = `Your Boarding Pass: ${input.airline} ${input.flightNumber} (${input.bookingReference})`;
    const selectedProvider = provider();
    const endpoint = requireSetting('AUTH_EMAIL_API_URL');
    const endpointUrl = new URL(endpoint);
    if (selectedProvider === 'postmark' && endpointUrl.protocol !== 'https:') {
        throw new Error('Postmark delivery requires HTTPS.');
    }
    if (
        selectedProvider === 'postmark' &&
        (endpointUrl.hostname !== 'api.postmarkapp.com' || endpointUrl.pathname !== '/email')
    ) {
        throw new Error('Postmark delivery requires the official email API endpoint.');
    }
    const from = requireSetting('AUTH_EMAIL_FROM');
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
    const body =
        selectedProvider === 'postmark'
            ? {
                  From: from,
                  To: input.to,
                  Subject: subject,
                  TextBody: text,
                  HtmlBody: formatTravelDocumentsEmailHtml(input),
                  MessageStream: 'outbound',
              }
            : {
                  From: mailpitSender(from),
                  To: [{ Email: input.to }],
                  Subject: subject,
                  Text: text,
                  HTML: formatTravelDocumentsEmailHtml(input),
              };

    if (selectedProvider === 'postmark') {
        headers['X-Postmark-Server-Token'] = requireSetting('AUTH_EMAIL_API_TOKEN');
    }
    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
        throw new Error(`Email provider rejected delivery (${response.status}).`);
    }
}


export function formatTravelDocumentsEmailHtml(input: TravelDocumentEmailInput): string {
    const formatPrice = (cents: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(cents / 100);
    };

    const passengerCards = input.passengers
        .map((p, index) => {
            const bagCount = p.bagCount !== undefined
                ? p.bagCount
                : (p.ancillaries ? p.ancillaries.filter(a => a.type.startsWith('CHECKED_BAG')).length : 0);
            const isPriority = p.priorityBoarding ?? (
                Boolean(p.ancillaries?.some(a => a.type === 'PRIORITY_BOARDING')) ||
                p.cabin.toUpperCase().includes('BUSINESS') ||
                p.cabin.toUpperCase().includes('FIRST')
            );
            const group = p.boardingGroup ?? (isPriority ? 'GROUP 1' : 'GROUP 3');
            
            let breakdownHtml = '';
            const fbHtml = p.fareBreakdown;
            const ancHtml = p.ancillaryTotalCents;
            if (fbHtml) {
                breakdownHtml = `
                    <div style="margin-top: 15px; border-top: 1px solid #ddd; padding-top: 10px;">
                        <strong>Fare Breakdown</strong>
                        <table style="width: 100%; font-size: 0.9em; margin-top: 5px;">
                            <tr><td>Base Airfare</td><td style="text-align: right;">${formatPrice(fbHtml.baseAirfareCents)}</td></tr>
                            <tr><td>Government Tax (7.5%)</td><td style="text-align: right;">${formatPrice(fbHtml.governmentTaxCents)}</td></tr>
                            <tr><td>Passenger Facility Charge</td><td style="text-align: right;">${formatPrice(fbHtml.pfcCents)}</td></tr>
                            <tr><td>Security Service Fee</td><td style="text-align: right;">${formatPrice(fbHtml.securityFeeCents)}</td></tr>
                            ${ancHtml ? `<tr><td>Baggage & Extras</td><td style="text-align: right;">${formatPrice(ancHtml)}</td></tr>` : ''}
                        </table>
                    </div>
                `;
            }

            return `
                <div style="border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 8px;">
                    <h3>Passenger ${index + 1}: ${p.name}</h3>
                    <p><strong>Seat:</strong> ${p.seat}</p>
                    <p><strong>Cabin:</strong> ${p.cabin}</p>
                    <p><strong>Boarding Group:</strong> ${group}${isPriority ? ' (PRIORITY BOARDING)' : ''}</p>
                    <p><strong>BAGS:</strong> ${bagCount}</p>
                    ${breakdownHtml}
                </div>
            `;
        })
        .join('');

    return `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2>Your Travel Documents</h2>
            <p>Here are your travel documents for flight <strong>${input.flightNumber}</strong>.</p>
            
            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <p><strong>Confirmation Reference:</strong> ${input.bookingReference}</p>
                <p><strong>Airline:</strong> ${input.airline}</p>
                <p><strong>Route:</strong> ${input.from} to ${input.toDestination}</p>
                <p><strong>Departure:</strong> ${input.departureReadable}</p>
            </div>
            
            ${passengerCards}
            
            <p style="margin-top: 20px; color: #666; font-size: 0.9em;">
                Please arrive at the airport with valid photo identification.<br>
                Thank you for flying with Mona Airways.
            </p>
        </div>
    `;
}
