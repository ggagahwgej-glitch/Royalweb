import 'server-only';
import { get, run, nowIso } from '@/lib/db';
import { ApiError } from '@/lib/api';

/**
 * Fixed-window rate limiter persisted in SQLite, so limits survive restarts.
 * Used for login attempts and general API mutation traffic.
 */
export function rateLimit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const windowStart = new Date(now - (now % (windowSeconds * 1000))).toISOString();
  const row = get<{ count: number; window_start: string }>(
    'SELECT count, window_start FROM rate_limits WHERE key = ?',
    key
  );
  if (!row || row.window_start !== windowStart) {
    run(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      key,
      windowStart
    );
    return { allowed: true, remaining: limit - 1, resetAt: new Date(now + windowSeconds * 1000) };
  }
  if (row.count >= limit) {
    const resetMs = new Date(windowStart).getTime() + windowSeconds * 1000;
    return { allowed: false, remaining: 0, resetAt: new Date(resetMs) };
  }
  run('UPDATE rate_limits SET count = count + 1 WHERE key = ?', key);
  return { allowed: true, remaining: limit - row.count - 1, resetAt: new Date(now + windowSeconds * 1000) };
}

export function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const result = rateLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    throw new ApiError(
      429,
      `Too many requests. Try again after ${result.resetAt.toISOString()}.`,
      'rate_limited'
    );
  }
  return result;
}

export function cleanupRateLimits() {
  run('DELETE FROM rate_limits WHERE window_start < ?', new Date(Date.now() - 86400_000).toISOString());
  void nowIso;
}
