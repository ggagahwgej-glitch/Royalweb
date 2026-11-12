import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError, ZodSchema } from 'zod';
import { getSession, AuthContext, requestMeta } from '@/lib/auth';
import { newId, nowIso, run } from '@/lib/db';

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: unknown;
  constructor(status: number, message: string, code = 'error', detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function jsonOk(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function jsonError(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: err.message, code: err.code, detail: err.detail ?? null },
      { status: err.status }
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Validation failed',
        code: 'validation_error',
        detail: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 }
    );
  }
  // Never leak internals/secrets to the client, but log server-side.
  console.error('[api] unhandled error:', err);
  return NextResponse.json(
    { ok: false, error: 'Internal server error', code: 'internal_error' },
    { status: 500 }
  );
}

export async function requireSession(): Promise<AuthContext> {
  const session = await getSession();
  if (!session) throw new ApiError(401, 'Authentication required', 'unauthenticated');
  return session;
}

/**
 * CSRF defence: reject cross-site state-changing requests. Combined with
 * SameSite=Lax httpOnly cookies and a required custom header that a
 * cross-origin HTML form cannot set.
 */
export async function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, 'Cross-site request blocked', 'csrf');
  }
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        throw new ApiError(403, 'Cross-origin request blocked', 'csrf');
      }
    } catch {
      throw new ApiError(403, 'Invalid origin', 'csrf');
    }
  }
  if (req.method !== 'GET' && req.headers.get('x-royalweb-request') !== '1') {
    throw new ApiError(403, 'Missing request verification header', 'csrf');
  }
}

export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON', 'bad_json');
  }
  return schema.parse(raw);
}

export type RouteCtx = { params: Promise<Record<string, string>> };

/** Wrap a route handler with consistent auth, CSRF and error handling. */
export function handler(
  fn: (req: NextRequest, ctx: RouteCtx, auth: AuthContext) => Promise<Response>
) {
  return async (req: NextRequest, ctx: RouteCtx) => {
    try {
      await assertSameOrigin(req);
      const auth = await requireSession();
      return await fn(req, ctx, auth);
    } catch (err) {
      return jsonError(err);
    }
  };
}

export async function audit(
  action: string,
  entity: string,
  entityId: string,
  userId?: string,
  meta?: Record<string, unknown>
) {
  const { ip } = await requestMeta().catch(() => ({ ip: '' }));
  run(
    'INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    userId ?? null,
    action,
    entity,
    entityId,
    ip,
    JSON.stringify(meta ?? {}),
    nowIso()
  );
}
