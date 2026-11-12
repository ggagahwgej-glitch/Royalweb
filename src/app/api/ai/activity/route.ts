import { handler, jsonOk } from '@/lib/api';
import { all } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Transparency: what the AI layer was asked to do and whether it succeeded. */
export const GET = handler(async (_req, _ctx, auth) => {
  const rows = all(
    `SELECT id, kind, provider, model, ok, error, prompt_tokens, completion_tokens, meta_json, created_at
       FROM ai_activity_logs WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 40`,
    auth.user.id
  );
  return jsonOk({ activity: rows });
});
