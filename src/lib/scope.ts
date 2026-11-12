/**
 * Workspace access control.
 *
 * Every resource belongs to an operator (`user_id`) *and* a workspace. Before
 * workspaces existed the routes only checked `user_id`, which was sufficient
 * when one operator meant one brand. In agency mode a single operator owns
 * several client workspaces, so `user_id` alone would let the active workspace
 * read, edit or delete another client's campaign, poster, content or credential
 * simply by knowing its id.
 *
 * Every `[id]` route therefore calls `inWorkspace()` after loading the row. The
 * predicate mirrors the list queries: a row belongs to the active workspace, or
 * — for legacy rows created before migration v6 — to the workspace marked active
 * on the user.
 */
import { get } from '@/lib/db';

export interface ScopeAuth {
  user: { id: string; role?: string };
  workspaceId: string | null;
}

type ScopedTable = 'campaigns' | 'media_assets' | 'connected_accounts' | 'generated_contents' | 'publishing_jobs' | 'manual_tasks';

const QUERIES: Record<ScopedTable, string> = {
  campaigns: `SELECT 1 AS ok FROM campaigns t
    WHERE t.id = ? AND t.user_id = ?
      AND (t.workspace_id = ? OR (t.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
  media_assets: `SELECT 1 AS ok FROM media_assets t
    WHERE t.id = ? AND t.user_id = ?
      AND (t.workspace_id = ? OR (t.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
  connected_accounts: `SELECT 1 AS ok FROM connected_accounts t
    WHERE t.id = ? AND t.user_id = ?
      AND (t.workspace_id = ? OR (t.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
  generated_contents: `SELECT 1 AS ok FROM generated_contents t
    JOIN campaigns c ON c.id = t.campaign_id
    WHERE t.id = ? AND c.user_id = ?
      AND (c.workspace_id = ? OR (c.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
  publishing_jobs: `SELECT 1 AS ok FROM publishing_jobs t
    JOIN campaigns c ON c.id = t.campaign_id
    WHERE t.id = ? AND c.user_id = ?
      AND (c.workspace_id = ? OR (c.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
  manual_tasks: `SELECT 1 AS ok FROM manual_tasks t
    JOIN campaigns c ON c.id = t.campaign_id
    WHERE t.id = ? AND c.user_id = ?
      AND (c.workspace_id = ? OR (c.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))`,
};

/** True when the resource exists in the operator's active workspace. */
export function inWorkspace(table: ScopedTable, id: string, auth: ScopeAuth): boolean {
  const query = QUERIES[table];
  if (!query) return false;
  const params = [id, auth.user.id, auth.workspaceId, auth.workspaceId, auth.user.id] as const;
  return Boolean(get<{ ok: number }>(query, ...params));
}

/** JS mirror of the SQL predicate, for rows already loaded. */
export function rowInWorkspace(row: { workspace_id?: string | null } | null | undefined, auth: ScopeAuth): boolean {
  if (!row) return false;
  if (row.workspace_id) return row.workspace_id === auth.workspaceId;
  const user = get<{ active_workspace_id: string | null }>(
    'SELECT active_workspace_id FROM users WHERE id = ?',
    auth.user.id
  );
  return (user?.active_workspace_id ?? null) === auth.workspaceId;
}
