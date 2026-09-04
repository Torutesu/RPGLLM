/** Injectable clock. Every time read in the API goes through this so `/__test/time-travel` works. */
export interface Clock {
  now(): Date;
  /** shift the clock forward (or back) by whole days; used by the TEST_HOOKS time-travel endpoint */
  offsetDays(days: number): void;
  offsetMs(): number;
  /** drop any time travel; `/__test/reset` calls it so one case cannot shift the next one's clock */
  reset(): void;
}

export function createClock(): Clock {
  let offsetMs = 0;
  return {
    now: () => new Date(Date.now() + offsetMs),
    offsetDays(days: number) {
      offsetMs += Math.round(days * 24 * 60 * 60 * 1000);
    },
    offsetMs: () => offsetMs,
    reset() {
      offsetMs = 0;
    },
  };
}

/** next UTC midnight strictly after `from` (the "local midnight" of the MVP's single UTC timezone) */
export function nextMidnight(from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0));
  return d;
}
