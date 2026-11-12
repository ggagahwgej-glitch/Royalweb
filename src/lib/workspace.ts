import 'server-only';
import { all, get, newId, nowIso, run, tx } from '@/lib/db';

/**
 * Workspaces (agency mode).
 *
 * A workspace is an isolated client brand: its own business identity, its own
 * connected platform accounts, its own SMTP sender identity, and its own
 * campaigns/calendar. One administrator owns several workspaces and switches
 * between them; every scoped query filters on `workspace_id`.
 *
 * Legacy rows created before workspaces existed have `workspace_id IS NULL` and
 * belong to the user's default workspace (the migration treats them that way),
 * so nothing disappears on upgrade.
 */

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  slug: string;
  color: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

function toWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    slug: String(row.slug),
    color: String(row.color ?? 'gold'),
    archived: Boolean(Number(row.archived ?? 0)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

function uniqueSlug(userId: string, base: string): string {
  const taken = new Set(
    all<{ slug: string }>('SELECT slug FROM workspaces WHERE user_id = ?', userId).map((r) => r.slug)
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 200; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Clone the business identity from a source (defaults to the user_settings seed). */
function seedSettings(workspaceId: string, from: Record<string, unknown> | undefined, name: string) {
  const ts = nowIso();
  run(
    `INSERT INTO workspace_settings (workspace_id, business_name, tagline, business_description, services_json,
       target_customers_json, price_min, price_max, cta_primary, cta_secondary, website_url, whatsapp_url,
       contact_email, contact_phone, public_contact_visible, default_timezone, default_language, ai_provider,
       ai_model, posting_frequency_hours, duplicate_window_hours, global_pause, auto_publish_enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO NOTHING`,
    workspaceId,
    String(from?.business_name ?? name),
    String(from?.tagline ?? 'Website Design & Development'),
    String(from?.business_description ?? ''),
    String(from?.services_json ?? '[]'),
    String(from?.target_customers_json ?? '[]'),
    String(from?.price_min ?? '2999'),
    String(from?.price_max ?? '4999'),
    String(from?.cta_primary ?? 'Get Your Business Website'),
    String(from?.cta_secondary ?? 'Contact Us / WhatsApp Enquiry'),
    String(from?.website_url ?? ''),
    String(from?.whatsapp_url ?? ''),
    String(from?.contact_email ?? ''),
    String(from?.contact_phone ?? ''),
    Number(from?.public_contact_visible ?? 0),
    String(from?.default_timezone ?? 'Asia/Kolkata'),
    String(from?.default_language ?? 'English'),
    String(from?.ai_provider ?? 'auto'),
    String(from?.ai_model ?? ''),
    Number(from?.posting_frequency_hours ?? 24),
    Number(from?.duplicate_window_hours ?? 72),
    Number(from?.global_pause ?? 0),
    Number(from?.auto_publish_enabled ?? 1),
    ts
  );
}

export function listWorkspaces(userId: string): Workspace[] {
  return all<Record<string, unknown>>(
    'SELECT * FROM workspaces WHERE user_id = ? AND archived = 0 ORDER BY created_at',
    userId
  ).map(toWorkspace);
}

export function createWorkspace(
  userId: string,
  input: { name: string; color?: string; cloneFrom?: string | null }
): Workspace {
  const name = input.name.trim().slice(0, 80) || 'New workspace';
  const id = newId();
  const ts = nowIso();
  const slug = uniqueSlug(userId, slugify(name));
  tx(() => {
    run(
      `INSERT INTO workspaces (id, user_id, name, slug, color, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      userId,
      name,
      slug,
      input.color ?? 'gold',
      ts,
      ts
    );
    const source = input.cloneFrom
      ? get<Record<string, unknown>>('SELECT * FROM workspace_settings WHERE workspace_id = ?', input.cloneFrom)
      : get<Record<string, unknown>>('SELECT * FROM user_settings WHERE user_id = ?', userId);
    seedSettings(id, source, name);
    run('UPDATE users SET active_workspace_id = ? WHERE id = ?', id, userId);
  });
  return toWorkspace(get<Record<string, unknown>>('SELECT * FROM workspaces WHERE id = ?', id)!);
}

/**
 * The workspace a request acts on. Created lazily so a fresh install (or an
 * install upgraded from before workspaces existed) always has one.
 */
export function activeWorkspace(userId: string): Workspace {
  const user = get<{ active_workspace_id: string | null }>(
    'SELECT active_workspace_id FROM users WHERE id = ?',
    userId
  );
  if (user?.active_workspace_id) {
    const row = get<Record<string, unknown>>(
      'SELECT * FROM workspaces WHERE id = ? AND user_id = ? AND archived = 0',
      user.active_workspace_id,
      userId
    );
    if (row) return toWorkspace(row);
  }
  const existing = get<Record<string, unknown>>(
    'SELECT * FROM workspaces WHERE user_id = ? AND archived = 0 ORDER BY created_at LIMIT 1',
    userId
  );
  if (existing) {
    run('UPDATE users SET active_workspace_id = ? WHERE id = ?', String(existing.id), userId);
    return toWorkspace(existing);
  }
  // First use: adopt the existing business identity, never invent a new brand.
  const id = newId();
  const ts = nowIso();
  const seed = get<Record<string, unknown>>('SELECT * FROM user_settings WHERE user_id = ?', userId);
  run(
    `INSERT INTO workspaces (id, user_id, name, slug, color, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'gold', 0, ?, ?)`,
    id,
    userId,
    String(seed?.business_name ?? 'My brand'),
    uniqueSlug(userId, slugify(String(seed?.business_name ?? 'my-brand'))),
    ts,
    ts
  );
  seedSettings(id, seed, String(seed?.business_name ?? 'My brand'));
  run('UPDATE users SET active_workspace_id = ? WHERE id = ?', id, userId);
  return toWorkspace(get<Record<string, unknown>>('SELECT * FROM workspaces WHERE id = ?', id)!);
}

export function activeWorkspaceId(userId: string): string {
  return activeWorkspace(userId).id;
}

export function switchWorkspace(userId: string, workspaceId: string): Workspace {
  const row = get<Record<string, unknown>>(
    'SELECT * FROM workspaces WHERE id = ? AND user_id = ? AND archived = 0',
    workspaceId,
    userId
  );
  if (!row) throw new Error('Workspace not found');
  run('UPDATE users SET active_workspace_id = ? WHERE id = ?', workspaceId, userId);
  return toWorkspace(row);
}

export function renameWorkspace(userId: string, workspaceId: string, patch: { name?: string; color?: string }) {
  const row = get<Record<string, unknown>>(
    'SELECT * FROM workspaces WHERE id = ? AND user_id = ?',
    workspaceId,
    userId
  );
  if (!row) throw new Error('Workspace not found');
  run(
    'UPDATE workspaces SET name = ?, color = ?, updated_at = ? WHERE id = ?',
    (patch.name ?? String(row.name)).trim().slice(0, 80),
    patch.color ?? String(row.color ?? 'gold'),
    nowIso(),
    workspaceId
  );
  return toWorkspace(get<Record<string, unknown>>('SELECT * FROM workspaces WHERE id = ?', workspaceId)!);
}

export function archiveWorkspace(userId: string, workspaceId: string) {
  const count = get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM workspaces WHERE user_id = ? AND archived = 0',
    userId
  );
  if (Number(count?.c ?? 0) <= 1) {
    throw new Error('You cannot archive the only workspace.');
  }
  const row = get<Record<string, unknown>>(
    'SELECT * FROM workspaces WHERE id = ? AND user_id = ? AND archived = 0',
    workspaceId,
    userId
  );
  if (!row) throw new Error('Workspace not found');
  run('UPDATE workspaces SET archived = 1, updated_at = ? WHERE id = ?', nowIso(), workspaceId);
  const active = activeWorkspace(userId);
  if (active.id === workspaceId) {
    const next = listWorkspaces(userId)[0];
    if (next) run('UPDATE users SET active_workspace_id = ? WHERE id = ?', next.id, userId);
  }
  return listWorkspaces(userId);
}

/**
 * SQL predicate for workspace-scoped tables. Legacy rows (NULL workspace) are
 * treated as belonging to the user's default workspace, so an upgrade never
 * hides existing campaigns.
 */
export function workspaceFilter(column = 'workspace_id'): string {
  return `(${column} = ? OR (${column} IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`;
}

/** Parameter triple matching workspaceFilter(). */
export function workspaceFilterParams(workspaceId: string, userId: string): [string, string, string] {
  return [workspaceId, workspaceId, userId];
}

export function workspaceStats(userId: string, workspaceId: string) {
  const count = (sql: string) =>
    Number(get<{ c: number }>(sql, userId, workspaceId, workspaceId, userId)?.c ?? 0);
  return {
    campaigns: count(`SELECT COUNT(*) AS c FROM campaigns WHERE user_id = ? AND ${workspaceFilter('workspace_id')}`),
    accounts: count(
      `SELECT COUNT(*) AS c FROM connected_accounts WHERE user_id = ? AND ${workspaceFilter('workspace_id')}`
    ),
    media: count(
      `SELECT COUNT(*) AS c FROM media_assets WHERE user_id = ? AND ${workspaceFilter('workspace_id')} AND deleted_at IS NULL`
    ),
  };
}
