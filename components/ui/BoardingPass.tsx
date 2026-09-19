import React from 'react';

export interface BoardingPassProps {
    passengerName: string;
    reference: string;
    airline: string;
    flightNumber: string;
    from: string;
    to: string;
    departureReadable: string;
    seat: string;
    cabin: string;
    bagCount?: number;
    priorityBoarding?: boolean;
    boardingGroup?: string;
}

/**
 * A persisted check-in projection, not the transient e-ticket shown at checkout.
 *
 * Every value comes from the owner-scoped `/checkin` query. The component has no
 * booking or passenger identifiers to send back to the server, and deliberately
 * carries none of the passport or date-of-birth data the passenger policy keeps
 * off customer surfaces.
 */
export default function BoardingPass({
    passengerName,
    reference,
    airline,
    flightNumber,
    from,
    to,
    departureReadable,
    seat,
    cabin,
    bagCount = 0,
    priorityBoarding = false,
    boardingGroup,
}: BoardingPassProps) {
    const group = boardingGroup || (priorityBoarding ? 'GROUP 1' : 'GROUP 3');
    return (
        <article
            className="checkin-boarding-pass"
            aria-label={`Boarding pass for ${passengerName} on ${airline} ${flightNumber}`}
        >
            <header className="checkin-boarding-pass-head">
                <div>
                    <p className="checkin-boarding-pass-kicker">Boarding pass</p>
                    <h3>{passengerName}</h3>
                    {priorityBoarding && (
                        <span
                            className="checkin-priority-badge"
                            style={{
                                display: 'inline-block',
                                background: '#eab308',
                                color: '#000',
                                fontWeight: 'bold',
                                fontSize: '0.7rem',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                marginTop: '4px',
                            }}
                        >
                            PRIORITY BOARDING
                        </span>
                    )}
                </div>
                <p className="checkin-boarding-pass-flight">
                    <span>{airline}</span>
                    <strong>{flightNumber}</strong>
                </p>
            </header>

            <dl className="checkin-boarding-pass-details">
                <div>
                    <dt>From</dt>
                    <dd>{from}</dd>
                </div>
                <div>
                    <dt>To</dt>
                    <dd>{to}</dd>
                </div>
                <div>
                    <dt>Departs</dt>
                    <dd>{departureReadable}</dd>
                </div>
                <div>
                    <dt>Assignment</dt>
                    <dd>{seat}</dd>
                </div>
                <div>
                    <dt>Cabin</dt>
                    <dd>{cabin}</dd>
                </div>
                <div>
                    <dt>Group</dt>
                    <dd>{group}</dd>
                </div>
                <div>
                    <dt>Baggage</dt>
                    <dd>BAGS: {bagCount}</dd>
                </div>
            </dl>

            <footer className="checkin-boarding-pass-foot">
                <span>Confirmation</span>
                <strong>{reference}</strong>
            </footer>
        </article>
    );
}
