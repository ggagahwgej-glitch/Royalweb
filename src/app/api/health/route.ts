import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { get, sqliteStatus } from '@/lib/db';
import { ensureBootstrap } from '@/lib/bootstrap';
import { ffmpegPath } from '@/lib/media/video';
import { runtimeReport } from '@/lib/runtime';
import { encryptionSelfTest } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

/**
 * Public health check — no secrets, no business data.
 *
 * It also reports how the deployment is put together: serverless or
 * disk-backed, persistent or ephemeral storage, and whether the scheduler is the
 * in-process worker or an external cron. A load balancer or uptime monitor can
 * hit this safely, and an operator can see at a glance why data would reset.
 *
 * This endpoint must never throw: when the database or the master key is
 * unusable, that IS the answer, so each subsystem is probed in isolation and the
 * response is still JSON (HTTP 503) — otherwise the failure only shows up as a
 * generic "server-side exception" page with an unreadable digest.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const deep = url.searchParams.get('deep') === '1' || url.searchParams.get('verbose') === '1';

  const checks: Check[] = [];
  const record = (id: string, fn: () => string) => {
    try {
      checks.push({ id, ok: true, detail: fn() });
    } catch (err) {
      checks.push({ id, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const sqlite = sqliteStatus();
  checks.push({
    id: 'node:sqlite',
    ok: sqlite.available,
    detail: sqlite.available
      ? `available on Node ${sqlite.node.replace(/^v/, '')}`
      : `${sqlite.error ?? 'unavailable'} (needs Node ${sqlite.minNode}+)`,
  });

  const runtime = runtimeReport();
  checks.push({
    id: 'storage',
    ok: runtime.writable && !runtime.dataDirIssue,
    detail: `${runtime.dataDir} (${runtime.storage}${runtime.dataDirIssue ? `; ${runtime.dataDirIssue}` : ''})`,
  });

  let database = 'unavailable';
  let platforms = 0;
  try {
    ensureBootstrap();
    database = get('SELECT 1 AS ok') ? 'ok' : 'unavailable';
    const row = get<{ c: number }>('SELECT COUNT(*) AS c FROM platforms');
    platforms = Number(row?.c || 0);
    checks.push({ id: 'database', ok: database === 'ok', detail: `${database} · ${platforms} platforms` });
  } catch (err) {
    checks.push({ id: 'database', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  if (deep && database === 'ok') {
    record('migrations', () => {
      const row = get<{ c: number; max: number | null }>('SELECT COUNT(*) AS c, MAX(version) AS max FROM schema_migrations');
      return `${Number(row?.c || 0)} applied · latest v${Number(row?.max || 0)}`;
    });
    record('bootstrap', () => {
      const row = get<{ c: number }>("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'");
      return `${Number(row?.c || 0)} indexes`;
    });
    record('uploads', () => {
      const dir = path.join(runtime.dataDir, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    });
  }

  const encryption = encryptionSelfTest();
  checks.push({
    id: 'encryption',
    ok: encryption.ok,
    detail: encryption.ok
      ? `AES-256-GCM round-trip ok · key from ${encryption.source}${encryption.variable ? ` (${encryption.variable})` : ''}`
      : `${encryption.error} · key source ${encryption.source}`,
  });

  let videoRenderer = false;
  try {
    videoRenderer = Boolean(await ffmpegPath());
  } catch {
    videoRenderer = false;
  }

  const failed = checks.filter((c) => !c.ok);
  const status = failed.length === 0 ? 'ok' : database === 'unavailable' || !sqlite.available ? 'failed' : 'degraded';

  const body = {
    status,
    ok: status === 'ok',
    database,
    platforms,
    videoRenderer,
    runtime: {
      platform: runtime.platform,
      serverless: runtime.serverless,
      storage: runtime.storage,
      durable: runtime.storage === 'persistent',
      worker: runtime.worker,
      region: runtime.region,
      node: runtime.node,
      writable: runtime.writable,
      dataDir: runtime.dataDir,
      dataDirRequested: runtime.dataDirRequested,
      dataDirIssue: runtime.dataDirIssue,
    },
    encryption: { ok: encryption.ok, keySource: encryption.source, variable: encryption.variable },
    checks,
    warnings: runtime.warnings,
    time: new Date().toISOString(),
  };

  return Response.json({ ok: status !== 'failed', data: body, error: null }, { status: status === 'failed' ? 503 : 200 });
}
