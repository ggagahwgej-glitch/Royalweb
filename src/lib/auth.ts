import 'server-only';
import { cookies, headers } from 'next/headers';
import { get, run, nowIso, newId } from '@/lib/db';
import { hashPassword, verifyPassword, randomToken, sha256, timingSafeEqualStr } from '@/lib/crypto';
import { activeWorkspaceId } from '@/lib/workspace';

export const SESSION_COOKIE = 'rw_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h idle+absolute session lifetime

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  /** The workspace this request acts on (agency mode). */
  workspaceId: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  failed_attempts: number;
  locked_until: string | null;
}

export async function requestMeta() {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return {
    ip: (fwd ? fwd.split(',')[0] : h.get('x-real-ip') || 'unknown').trim(),
    userAgent: (h.get('user-agent') || 'unknown').slice(0, 300),
  };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const meta = await requestMeta();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    userId,
    sha256(token),
    meta.ip,
    meta.userAgent,
    nowIso(),
    expires,
    nowIso()
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return token;
}

export async function getSession(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = get<{
    session_id: string;
    expires_at: string;
    revoked_at: string | null;
    id: string;
    email: string;
    name: string;
    role: string;
  }>(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    sha256(token)
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run('UPDATE sessions SET revoked_at = ? WHERE id = ?', nowIso(), row.session_id);
    return null;
  }
  return {
    sessionId: row.session_id,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
    workspaceId: activeWorkspaceId(row.id),
  };
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', nowIso(), sha256(token));
  }
  jar.delete(SESSION_COOKIE);
}

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'invalid' | 'locked' | 'disabled'; retryAfterSeconds?: number };

export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const user = get<UserRow>('SELECT * FROM users WHERE lower(email) = ?', normalized);
  // Always run a hash comparison to equalize timing.
  if (!user) {
    verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA');
    return { ok: false, reason: 'invalid' };
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterSeconds: Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 1000),
    };
  }
  if (!verifyPassword(password, user.password_hash)) {
    const attempts = Number(user.failed_attempts) + 1;
    const lockUntil =
      attempts >= 8 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    run(
      'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      attempts,
      lockUntil,
      nowIso(),
      user.id
    );
    return { ok: false, reason: 'invalid' };
  }
  run(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    nowIso(),
    nowIso(),
    user.id
  );
  await createSession(user.id);
  return { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

export function countUsers(): number {
  const row = get<{ c: number }>('SELECT COUNT(*) AS c FROM users');
  return Number(row?.c || 0);
}

export function createAdmin(input: {
  email: string;
  password: string;
  name: string;
}): SessionUser {
  const id = newId();
  const ts = nowIso();
  run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', ?, ?)`,
    id,
    input.email.trim().toLowerCase(),
    hashPassword(input.password),
    input.name.trim() || 'Administrator',
    ts,
    ts
  );
  run(
    `INSERT INTO user_settings (user_id, business_name, tagline, business_description, services_json,
       target_customers_json, price_min, price_max, cta_primary, cta_secondary, website_url, whatsapp_url,
       contact_email, contact_phone, public_contact_visible, updated_at)
     VALUES (?, 'ROYALWEB', 'Website Design & Development',
       'ROYALWEB designs and develops fast, mobile-friendly websites for local businesses — restaurants, cafes, hotels, coaching institutes, interior designers, fitness coaches and more.',
       ?, ?, '2999', '4999', 'Get Your Business Website', 'Contact Us / WhatsApp Enquiry', '', '', '', '', 0, ?)`,
    id,
    JSON.stringify([
      'Restaurant Website Development',
      'Cafe Website Development',
      'Business Website Development',
      'Landing Page Development',
      'Lead Generation Landing Pages',
      'Portfolio Websites',
      'Service Business Websites',
      'Custom Website Development',
    ]),
    JSON.stringify([
      'Restaurants',
      'Cafes',
      'Hotels',
      'Coaching Institutes',
      'Interior Designers',
      'Fitness Coaches',
      'Local Businesses',
      'Event Organizers',
      'Small and Medium Businesses',
      'Business Owners Without Websites',
    ]),
    ts
  );
  return { id, email: input.email.trim().toLowerCase(), name: input.name, role: 'admin' };
}

export async function changePassword(userId: string, current: string, next: string): Promise<boolean> {
  const user = get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  if (!user) return false;
  if (!verifyPassword(current, user.password_hash)) return false;
  run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    hashPassword(next),
    nowIso(),
    userId
  );
  // Invalidate every other session.
  run(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    nowIso(),
    userId
  );
  return true;
}

/** Timing-safe comparison helper re-exported for CSRF/state checks. */
export { timingSafeEqualStr };
