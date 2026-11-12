/** Timezone helpers — scheduling is stored in UTC and displayed in the user's zone. */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export function partsInZone(date: Date, tz: string) {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

export function tzOffsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** Convert a local wall-clock string (YYYY-MM-DDTHH:mm) in `tz` to a UTC ISO string. */
export function zonedToUtc(local: string, tz: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) throw new Error(`Invalid local time: ${local}`);
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = tzOffsetMs(new Date(guess), tz);
  let utc = guess - offset;
  const secondOffset = tzOffsetMs(new Date(utc), tz);
  if (secondOffset !== offset) utc = guess - secondOffset;
  return new Date(utc).toISOString();
}

/** Render a UTC ISO string as a `datetime-local` value in `tz`. */
export function utcToLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const p = partsInZone(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz || 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < minute) return 'just now';
  if (abs < hour) return `${Math.round(abs / minute)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  if (abs < 30 * day) return `${Math.round(abs / day)}d ${suffix}`;
  return new Date(iso).toLocaleDateString();
}

/** Next 10:00 (local time in tz), at least 30 minutes away. */
export function nextMorningSlot(tz: string): string {
  const now = new Date(Date.now() + 30 * 60_000);
  const p = partsInZone(now, tz);
  const todayAt10 = zonedToUtc(
    `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T10:00`,
    tz
  );
  if (new Date(todayAt10).getTime() > Date.now() + 30 * 60_000) return todayAt10;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const t = partsInZone(tomorrow, tz);
  return zonedToUtc(
    `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}T10:00`,
    tz
  );
}
