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
}: BoardingPassProps) {
    return (
        <article
            className="checkin-boarding-pass"
            aria-label={`Boarding pass for ${passengerName} on ${airline} ${flightNumber}`}
        >
            <header className="checkin-boarding-pass-head">
                <div>
                    <p className="checkin-boarding-pass-kicker">Boarding pass</p>
                    <h3>{passengerName}</h3>
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
            </dl>

            <footer className="checkin-boarding-pass-foot">
                <span>Confirmation</span>
                <strong>{reference}</strong>
            </footer>
        </article>
    );
}
