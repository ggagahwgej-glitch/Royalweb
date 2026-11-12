import { z } from 'zod';
import { handler, jsonOk, parseBody, audit, ApiError } from '@/lib/api';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  archiveWorkspace,
  createWorkspace,
  listWorkspaces,
  renameWorkspace,
  switchWorkspace,
  workspaceStats,
} from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export const GET = handler(async (_req, _ctx, auth) => {
  const workspaces = listWorkspaces(auth.user.id);
  return jsonOk({
    activeId: auth.workspaceId,
    workspaces: workspaces.map((w) => ({
      ...w,
      stats: workspaceStats(auth.user.id, w.id),
      active: w.id === auth.workspaceId,
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  cloneFrom: z.string().uuid().nullable().optional(),
});

export const POST = handler(async (req, _ctx, auth) => {
  if (auth.user.role !== 'admin') throw new ApiError(403, 'Admin only', 'admin_only');
  enforceRateLimit(`workspace-create:${auth.user.id}`, 20, 3600);
  const body = await parseBody(req, createSchema);
  const workspace = createWorkspace(auth.user.id, body);
  await audit('workspace.created', 'workspace', workspace.id, auth.user.id, { name: workspace.name });
  return jsonOk({ workspace, workspaces: listWorkspaces(auth.user.id) });
});

const patchSchema = z.object({
  activeId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80).optional(),
  color: z.string().max(20).optional(),
  archive: z.boolean().optional(),
});

/** Switch the active workspace, rename one, or archive one. */
export const PATCH = handler(async (req, _ctx, auth) => {
  const body = await parseBody(req, patchSchema);
  try {
    if (body.activeId) {
      switchWorkspace(auth.user.id, body.activeId);
      await audit('workspace.switched', 'workspace', body.activeId, auth.user.id);
    }
    if (body.workspaceId && (body.name || body.color)) {
      renameWorkspace(auth.user.id, body.workspaceId, { name: body.name, color: body.color });
      await audit('workspace.renamed', 'workspace', body.workspaceId, auth.user.id, { name: body.name });
    }
    if (body.workspaceId && body.archive) {
      archiveWorkspace(auth.user.id, body.workspaceId);
      await audit('workspace.archived', 'workspace', body.workspaceId, auth.user.id);
    }
  } catch (err) {
    throw new ApiError(400, (err as Error).message, 'workspace_error');
  }
  return jsonOk({ workspaces: listWorkspaces(auth.user.id) });
});
