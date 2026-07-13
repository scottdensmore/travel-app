import { after } from 'next/server';

export function scheduleAfterResponse(operation: () => Promise<void>): void {
    after(operation);
}
