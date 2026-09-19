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
                  MessageStream: 'outbound',
              }
            : {
                  From: mailpitSender(from),
                  To: [{ Email: input.to }],
                  Subject: subject,
                  Text: text,
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
