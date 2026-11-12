import 'server-only';
import { all, get, run, nowIso } from '@/lib/db';
import { ADAPTERS } from '@/lib/platforms';
import { countUsers, createAdmin } from '@/lib/auth';

declare global {
  // eslint-disable-next-line no-var
  var __royalwebBootstrapped: boolean | undefined;
}

/**
 * Idempotent startup work: seed the 25-platform catalogue and create the
 * first administrator from environment variables when the database is empty.
 */
export function ensureBootstrap() {
  if (globalThis.__royalwebBootstrapped) return;
  seedPlatforms();
  seedFirstAdmin();
  globalThis.__royalwebBootstrapped = true;
}

export function seedPlatforms() {
  const existing = new Set(
    all<{ id: string }>('SELECT id FROM platforms').map((r) => r.id)
  );
  ADAPTERS.forEach((adapter, index) => {
    if (existing.has(adapter.id)) {
      // Keep catalogue metadata in sync with the code (name, docs, integration).
      run(
        `UPDATE platforms SET name = ?, grp = ?, automation = ?, integration = ?, docs_url = ?, notes = ?, sort_order = ?
          WHERE id = ?`,
        adapter.name,
        adapter.group,
        adapter.automation,
        adapter.integration,
        adapter.docsUrl,
        adapter.notes,
        index + 1,
        adapter.id
      );
      return;
    }
    run(
      `INSERT INTO platforms (id, name, grp, automation, integration, docs_url, enabled, credential_status,
         notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, 'not_connected', ?, ?)`,
      adapter.id,
      adapter.name,
      adapter.group,
      adapter.automation,
      adapter.integration,
      adapter.docsUrl,
      adapter.notes,
      index + 1
    );
  });
}

function seedFirstAdmin() {
  if (countUsers() > 0) return;
  const email = process.env.ROYALWEB_ADMIN_EMAIL;
  const password = process.env.ROYALWEB_ADMIN_PASSWORD;
  if (!email || !password) return;
  createAdmin({ email, password, name: process.env.ROYALWEB_ADMIN_NAME || 'ROYALWEB Admin' });
  console.log(`[bootstrap] Created first administrator: ${email}`);
  void nowIso;
  void get;
}
