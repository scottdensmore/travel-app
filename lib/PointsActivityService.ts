import { PointsActivityData, StartingPoints } from "./data/PointsActivityData";
import { PointsActivityDisplayData } from "./types/PointsActivity";
import { Booking, Flight } from "@prisma/client";
import { bookingTotalCents } from "./bookingPricing";
import { outboundFlight } from "./bookingItinerary";
import {
  DEFAULT_ACCOUNT_TIME_ZONE,
  formatAccountDateTime,
  normalizeAccountTimeZone,
} from './accountTimeZone';

/**
 * Only what this service reads. Tying it to the Prisma model meant a flight
 * whose route had been resolved from its airports no longer fitted, though it
 * carried every field used here (#73).
 */
type ActivityFlight = Pick<Flight, 'id' | 'airline' | 'flightNumber' | 'priceCents'> & {
  from: string;
  to: string;
};

type BookingLeg = { sequence: number; flight: ActivityFlight | null };
type BookingWithFlight = Booking & {
  flight?: ActivityFlight | null;
  legs: BookingLeg[];
  statusChanges?: Array<{ createdAt: Date }>;
};

function accountMonthKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(value);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Could not format account month');
  return `${year}-${month}`;
}

function offsetMonth(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function accountMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

class PointsActivityService {
  private bookings: BookingWithFlight[] | null;
  private startingPoints: number;
  private accountTimeZone: string;

  constructor(
    bookings?: BookingWithFlight[],
    startingPoints?: number,
    accountTimeZone = DEFAULT_ACCOUNT_TIME_ZONE,
  ) {
    this.bookings = bookings !== undefined ? bookings : null;
    this.startingPoints = startingPoints !== undefined ? startingPoints : StartingPoints;
    this.accountTimeZone = normalizeAccountTimeZone(accountTimeZone)
      ?? DEFAULT_ACCOUNT_TIME_ZONE;
  }

  /** Whole status points earned by a booking, from its stored total. */
  private bookingPoints(booking: BookingWithFlight): number {
    return Math.floor(bookingTotalCents(booking, outboundFlight(booking)) / 100);
  }

  getCurrentPoints(): number {
    if (this.bookings === null) {
      return PointsActivityData.reduce((total, activity) => total + activity.points, this.startingPoints);
    }
    return this.bookings.reduce((total, booking) => {
      if (booking.status === 'CANCELLED') return total;
      return total + this.bookingPoints(booking);
    }, this.startingPoints);
  }

  getCurrentStatus(): string {
    const points = this.getCurrentPoints();
    if (points < 1000) return "Bronze";
    if (points < 3000) return "Silver";
    if (points < 6000) return "Gold";
    return "Platinum";
  }

  getPointsActivity(): PointsActivityDisplayData[] {
    if (this.bookings === null) {
      const displayData: PointsActivityDisplayData[] = PointsActivityData.map((activity) => ({
        description: activity.description,
        date: formatAccountDateTime(activity.date, this.accountTimeZone),
        points: activity.points
      }));
      displayData.push({
        description: 'Starting Points',
        date: '',
        points: this.startingPoints
      });
      return displayData;
    }

    const displayData: PointsActivityDisplayData[] = [];
    this.bookings.forEach((booking) => {
      const flight = outboundFlight(booking);
      const points = this.bookingPoints(booking);
      const baseDesc = flight 
        ? `✈️ ${flight.airline} ${flight.flightNumber} (${flight.from} → ${flight.to})`
        : '✈️ Flight Booking';
      
      if (booking.status === 'CANCELLED') {
        // 1. Show original positive booking credit
        displayData.push({
          description: baseDesc,
          date: formatAccountDateTime(booking.createdAt, this.accountTimeZone),
          points: points
        });
        // 2. Show cancellation debit
        displayData.push({
          description: `❌ Cancelled: ${baseDesc.replace('✈️ ', '')}`,
          date: formatAccountDateTime(
            booking.statusChanges?.[0]?.createdAt ?? booking.createdAt,
            this.accountTimeZone,
          ),
          points: -points
        });
      } else {
        displayData.push({
          description: baseDesc,
          date: formatAccountDateTime(booking.createdAt, this.accountTimeZone),
          points: points
        });
      }
    });

    displayData.push({
      description: 'Starting Points',
      date: '',
      points: this.startingPoints
    });

    return displayData;
  }

  getMonthlyPointsActivity(): PointsActivityDisplayData[] {
    const monthlyPointsMap: Record<string, number> = {};
    if (this.bookings === null) {
      PointsActivityData.forEach(activity => {
        const monthKey = accountMonthKey(activity.date, this.accountTimeZone);
        monthlyPointsMap[monthKey] = (monthlyPointsMap[monthKey] || 0) + activity.points;
      });
    } else {
      this.bookings.forEach((booking) => {
        const monthKey = accountMonthKey(booking.createdAt, this.accountTimeZone);
        const points = this.bookingPoints(booking);
        monthlyPointsMap[monthKey] = (monthlyPointsMap[monthKey] || 0) + points;
        if (booking.status === 'CANCELLED') {
          const cancellationMonthKey = accountMonthKey(
            booking.statusChanges?.[0]?.createdAt ?? booking.createdAt,
            this.accountTimeZone,
          );
          monthlyPointsMap[cancellationMonthKey]
            = (monthlyPointsMap[cancellationMonthKey] || 0) - points;
        }
      });
    }

    const sortedMonths = Object.keys(monthlyPointsMap).sort();
    let allMonths: string[] = [];

    if (sortedMonths.length > 0) {
      const firstMonth = offsetMonth(sortedMonths[0], -1);
      const lastMonth = sortedMonths[sortedMonths.length - 1];
      for (let monthKey = firstMonth; monthKey <= lastMonth; monthKey = offsetMonth(monthKey, 1)) {
        allMonths.push(monthKey);
      }
    } else {
      const currentMonth = accountMonthKey(new Date(), this.accountTimeZone);
      allMonths = [
        offsetMonth(currentMonth, -1),
        currentMonth,
      ];
    }

    let cumulativePoints = this.startingPoints;
    return allMonths.map(monthKey => {
      if (monthlyPointsMap[monthKey]) {
        cumulativePoints += monthlyPointsMap[monthKey];
      }
      const monthLabel = accountMonthLabel(monthKey);
      return {
        description: monthLabel,
        date: monthLabel,
        points: cumulativePoints
      };
    });
  }
}

export default PointsActivityService;
