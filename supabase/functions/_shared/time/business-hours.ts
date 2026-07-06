// Business-hours math for SLA measurement. The seeded rules are business_hours_only
// and the org runs on an Asia/Dubai business calendar, so measuring wall-clock
// elapsed time produced spurious breaches (a 6pm enquiry answered at 9am read as
// a ~900-minute breach against a 240-minute SLA). businessMinutesBetween clamps
// elapsed time to the configured working window.

export interface BusinessHours {
  tz: string;               // IANA tz, e.g. 'Asia/Dubai'
  start: string;            // 'HH:MM'
  end: string;              // 'HH:MM'
  workdays: number[];       // JS getDay(): 0=Sun … 6=Sat (e.g. [1,2,3,4,5] Mon–Fri)
}

/** Minutes to add to a UTC instant to get local wall-clock in `tz`. */
function offsetMs(instant: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - instant;
}

/**
 * Business minutes elapsed between two ISO instants within the working window.
 * Returns whole minutes (rounded). Falls back to wall-clock if `bh` is missing.
 */
export function businessMinutesBetween(startIso: string, endIso: string, bh?: BusinessHours | null): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!(end > start)) return 0;
  if (!bh || !bh.tz || !bh.start || !bh.end || !bh.workdays?.length) {
    return Math.round((end - start) / 60000);
  }
  const [sh, sm] = bh.start.split(':').map(Number);
  const [eh, em] = bh.end.split(':').map(Number);
  const workdays = new Set(bh.workdays);

  let total = 0;
  let cursor = start;
  let guard = 0;
  while (cursor < end && guard++ < 500) {
    const off = offsetMs(cursor, bh.tz);
    const local = new Date(cursor + off);
    const y = local.getUTCFullYear(), mo = local.getUTCMonth(), d = local.getUTCDate();
    const weekday = local.getUTCDay();

    const winStart = Date.UTC(y, mo, d, sh, sm) - off;
    const winEnd = Date.UTC(y, mo, d, eh, em) - off;
    if (workdays.has(weekday)) {
      const s = Math.max(start, winStart, cursor);
      const e = Math.min(end, winEnd);
      if (e > s) total += (e - s) / 60000;
    }
    // advance to next local midnight
    cursor = Date.UTC(y, mo, d + 1, 0, 0) - off;
  }
  return Math.round(total);
}
