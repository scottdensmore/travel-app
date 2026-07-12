import { PointsActivityData, StartingPoints } from "./data/PointsActivityData";
import { PointsActivityDisplayData } from "./types/PointsActivity";
import { Booking, Flight } from "@prisma/client";

type BookingWithFlight = Booking & { flight: Flight | null };

class PointsActivityService {
  private bookings: BookingWithFlight[] | null;
  private startingPoints: number;

  constructor(bookings?: BookingWithFlight[], startingPoints?: number) {
    this.bookings = bookings !== undefined ? bookings : null;
    this.startingPoints = startingPoints !== undefined ? startingPoints : StartingPoints;
  }

  private parsePrice(priceStr: string | null | undefined): number {
    if (!priceStr) return 0;
    return parseInt(priceStr.replace(/[^0-9]/g, ""), 10) || 0;
  }

  getCurrentPoints(): number {
    if (this.bookings === null) {
      return PointsActivityData.reduce((total, activity) => total + activity.points, this.startingPoints);
    }
    return this.bookings.reduce((total, booking) => {
      if (booking.status === 'CANCELLED') return total;
      const priceStr = booking.totalPrice || booking.flight?.price;
      const price = this.parsePrice(priceStr);
      return total + price;
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
        date: activity.date.toLocaleDateString(),
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
      const flight = booking.flight;
      const priceStr = booking.totalPrice || flight?.price;
      const points = this.parsePrice(priceStr);
      const baseDesc = flight 
        ? `✈️ ${flight.airline} ${flight.flightNumber} (${flight.from} → ${flight.to})`
        : '✈️ Flight Booking';
      
      if (booking.status === 'CANCELLED') {
        // 1. Show original positive booking credit
        displayData.push({
          description: baseDesc,
          date: new Date(booking.createdAt).toLocaleDateString(),
          points: points
        });
        // 2. Show cancellation debit
        displayData.push({
          description: `❌ Cancelled: ${baseDesc.replace('✈️ ', '')}`,
          date: new Date(booking.createdAt).toLocaleDateString(),
          points: -points
        });
      } else {
        displayData.push({
          description: baseDesc,
          date: new Date(booking.createdAt).toLocaleDateString(),
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
    if (this.bookings === null) {
      const monthlyPointsMap: { [key: string]: number } = {};
      PointsActivityData.forEach((activity) => {
        const monthYear = activity.date.toLocaleString('default', { month: 'short', year: 'numeric' });
        monthlyPointsMap[monthYear] = (monthlyPointsMap[monthYear] || 0) + activity.points;
      });

      const sortedMonths = Object.keys(monthlyPointsMap).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const startDate = new Date(sortedMonths[0]);
      startDate.setMonth(startDate.getMonth() - 1);
      const endDate = new Date(sortedMonths[sortedMonths.length - 1]);
      const allMonths: string[] = [];
      for (let date = new Date(startDate); date <= endDate; date.setMonth(date.getMonth() + 1)) {
        allMonths.push(date.toLocaleString('default', { month: 'short', year: 'numeric' }));
      }

      let cumulativePoints = this.startingPoints;
      return allMonths.map(monthYear => {
        if (monthlyPointsMap[monthYear]) {
          cumulativePoints += monthlyPointsMap[monthYear];
        }
        return {
          description: monthYear,
          date: monthYear,
          points: cumulativePoints
        };
      });
    }

    const monthlyPointsMap: { [key: string]: number } = {};
    this.bookings.forEach((booking) => {
      const date = new Date(booking.createdAt);
      const monthYear = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      const priceStr = booking.totalPrice || booking.flight?.price;
      const points = this.parsePrice(priceStr);
      if (booking.status === 'CANCELLED') {
        // Cancellation balances out to 0 net points for this month
        monthlyPointsMap[monthYear] = (monthlyPointsMap[monthYear] || 0) + points - points;
      } else {
        monthlyPointsMap[monthYear] = (monthlyPointsMap[monthYear] || 0) + points;
      }
    });

    const sortedMonths = Object.keys(monthlyPointsMap).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    let allMonths: string[] = [];

    if (sortedMonths.length > 0) {
      const startDate = new Date(sortedMonths[0]);
      startDate.setMonth(startDate.getMonth() - 1);
      const endDate = new Date(sortedMonths[sortedMonths.length - 1]);
      for (let date = new Date(startDate); date <= endDate; date.setMonth(date.getMonth() + 1)) {
        allMonths.push(date.toLocaleString('default', { month: 'short', year: 'numeric' }));
      }
    } else {
      const now = new Date();
      allMonths = [
        new Date(now.getFullYear(), now.getMonth() - 1).toLocaleString('default', { month: 'short', year: 'numeric' }),
        now.toLocaleString('default', { month: 'short', year: 'numeric' })
      ];
    }

    let cumulativePoints = this.startingPoints;
    return allMonths.map(monthYear => {
      if (monthlyPointsMap[monthYear]) {
        cumulativePoints += monthlyPointsMap[monthYear];
      }
      return {
        description: monthYear,
        date: monthYear,
        points: cumulativePoints
      };
    });
  }
}

export default PointsActivityService;