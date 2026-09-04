/**
 * A five-field cron evaluator, in UTC, with no dependency.
 *
 * The worker only has to answer two questions — "is this expression due at minute X?" and "when is
 * it next due?" — for the handful of expressions in `@rpgllm/shared`'s `JOBS` table. That is 60
 * lines of arithmetic, so it is written here rather than pulling in a scheduler library whose cron
 * dialect we would then have to pin.
 *
 *   ┌ minute (0-59)   ┌ hour (0-23)   ┌ day of month (1-31)   ┌ month (1-12)   ┌ day of week (0-7, 0 and 7 = Sunday)
 *   Each field takes `*`, `a`, `a-b`, `a,b,c`, or any of those with a `/n` step.
 *
 * Day-of-month and day-of-week follow the classic Vixie rule: when **both** are restricted the
 * expression matches if **either** does; when only one is restricted, only that one has to match.
 */

interface Field {
  /** minute→month: the allowed values, already expanded */
  values: Set<number>;
  /** true when the field was `*` (or a step over the whole range, which is the same thing) */
  wildcard: boolean;
}

export interface CronExpression {
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
  source: string;
}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
} as const;

function parseField(raw: string, [min, max]: readonly [number, number], name: string): Field {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of raw.split(",")) {
    const [spec, stepRaw] = part.split("/");
    if (spec === undefined || spec === "") throw new Error(`cron: empty ${name} field in "${raw}"`);
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron: bad step "${stepRaw ?? ""}" in ${name}`);
    let lo: number;
    let hi: number;
    if (spec === "*") {
      lo = min;
      hi = max;
      if (step === 1) wildcard = true;
    } else if (spec.includes("-")) {
      const [a, b] = spec.split("-").map(Number);
      if (a === undefined || b === undefined || !Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`cron: bad range "${spec}" in ${name}`);
      }
      lo = a;
      hi = b;
    } else {
      const n = Number(spec);
      if (!Number.isInteger(n)) throw new Error(`cron: bad value "${spec}" in ${name}`);
      lo = n;
      hi = n;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron: ${name} value out of range in "${raw}"`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  // Sunday is both 0 and 7.
  if (name === "dayOfWeek" && values.has(7)) values.add(0);
  return { values, wildcard };
}

export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron: expected 5 fields, got ${parts.length} in "${expression}"`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
  return {
    minute: parseField(minute, RANGES.minute, "minute"),
    hour: parseField(hour, RANGES.hour, "hour"),
    dayOfMonth: parseField(dayOfMonth, RANGES.dayOfMonth, "dayOfMonth"),
    month: parseField(month, RANGES.month, "month"),
    dayOfWeek: parseField(dayOfWeek, RANGES.dayOfWeek, "dayOfWeek"),
    source: expression,
  };
}

/** Does `date` (to the minute, UTC) satisfy the expression? */
export function cronMatches(expr: CronExpression, date: Date): boolean {
  if (!expr.minute.values.has(date.getUTCMinutes())) return false;
  if (!expr.hour.values.has(date.getUTCHours())) return false;
  if (!expr.month.values.has(date.getUTCMonth() + 1)) return false;

  const domOk = expr.dayOfMonth.values.has(date.getUTCDate());
  const dowOk = expr.dayOfWeek.values.has(date.getUTCDay());
  if (expr.dayOfMonth.wildcard && expr.dayOfWeek.wildcard) return true;
  if (expr.dayOfMonth.wildcard) return dowOk;
  if (expr.dayOfWeek.wildcard) return domOk;
  return domOk || dowOk;
}

const MINUTE_MS = 60_000;

/**
 * The first minute **strictly after** `from` that matches. Days that cannot match are skipped
 * whole, so the worst case is ~400 day probes plus one day of minutes, not a year of minutes.
 * Returns null when the expression can never fire (e.g. `0 0 30 2 *`).
 */
export function nextCronRun(expr: CronExpression, from: Date): Date | null {
  const start = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  const cursor = new Date(start);
  for (let day = 0; day <= 400; day += 1) {
    const dayMatches = cronMatches(
      expr,
      // probe the day at a minute/hour the expression definitely allows
      new Date(Date.UTC(
        cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
        [...expr.hour.values][0] ?? 0, [...expr.minute.values][0] ?? 0,
      )),
    );
    if (dayMatches) {
      const endOfDay = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1);
      for (let t = cursor.getTime(); t < endOfDay; t += MINUTE_MS) {
        const candidate = new Date(t);
        if (cronMatches(expr, candidate)) return candidate;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }
  return null;
}

/** Convenience for callers that hold the raw string (parses, then answers). */
export const nextRunAtFor = (expression: string, from: Date): Date | null => nextCronRun(parseCron(expression), from);
