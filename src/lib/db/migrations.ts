/**
 * Versioned database migrations for ROYALWEB AUTOPILOT.
 *
 * Engine: SQLite (node:sqlite, built into Node 22) — a real persistent database
 * on disk. The schema is written in portable SQL so it can be moved to
 * PostgreSQL/Supabase by swapping the query layer if desired (see docs/SETUP.md).
 *
 * Every migration is applied once and recorded in schema_migrations.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'core_schema',
    sql: `
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      name            TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'admin',
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    TEXT,
      last_login_at   TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash   TEXT NOT NULL UNIQUE,
      ip           TEXT,
      user_agent   TEXT,
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      revoked_at   TEXT,
      last_seen_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      business_name           TEXT NOT NULL DEFAULT 'ROYALWEB',
      tagline                 TEXT NOT NULL DEFAULT 'Website Design & Development',
      business_description    TEXT NOT NULL DEFAULT '',
      services_json           TEXT NOT NULL DEFAULT '[]',
      target_customers_json   TEXT NOT NULL DEFAULT '[]',
      price_min               TEXT NOT NULL DEFAULT '',
      price_max               TEXT NOT NULL DEFAULT '',
      cta_primary             TEXT NOT NULL DEFAULT '',
      cta_secondary           TEXT NOT NULL DEFAULT '',
      website_url             TEXT NOT NULL DEFAULT '',
      whatsapp_url            TEXT NOT NULL DEFAULT '',
      contact_email           TEXT NOT NULL DEFAULT '',
      contact_phone           TEXT NOT NULL DEFAULT '',
      public_contact_visible  INTEGER NOT NULL DEFAULT 0,
      default_timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      default_language        TEXT NOT NULL DEFAULT 'English',
      ai_provider             TEXT NOT NULL DEFAULT 'auto',
      ai_model                TEXT NOT NULL DEFAULT '',
      posting_frequency_hours INTEGER NOT NULL DEFAULT 24,
      duplicate_window_hours  INTEGER NOT NULL DEFAULT 72,
      global_pause            INTEGER NOT NULL DEFAULT 0,
      auto_publish_enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at              TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platforms (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      grp             TEXT NOT NULL,              -- A | B | C
      automation      TEXT NOT NULL,              -- automatic | approval | manual
      integration     TEXT NOT NULL,              -- official API name / manual
      docs_url        TEXT NOT NULL DEFAULT '',
      enabled         INTEGER NOT NULL DEFAULT 1,
      credential_status TEXT NOT NULL DEFAULT 'not_connected',
      last_activity_at TEXT,
      last_error      TEXT,
      last_error_at   TEXT,
      notes           TEXT NOT NULL DEFAULT '',
      sort_order      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS connected_accounts (
      id                TEXT PRIMARY KEY,
      platform_id       TEXT NOT NULL REFERENCES platforms(id),
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_name      TEXT NOT NULL,
      external_id       TEXT,
      credentials_cipher TEXT NOT NULL,          -- AES-256-GCM, never plaintext
      scopes            TEXT NOT NULL DEFAULT '',
      token_expires_at  TEXT,
      status            TEXT NOT NULL DEFAULT 'connected', -- connected | expired | error | revoked
      last_verified_at  TEXT,
      last_error        TEXT,
      meta_json         TEXT NOT NULL DEFAULT '{}',
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      UNIQUE (platform_id, account_name)
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_platform ON connected_accounts(platform_id, status);

    CREATE TABLE IF NOT EXISTS campaigns (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      business_category TEXT NOT NULL DEFAULT '',
      service_name      TEXT NOT NULL DEFAULT '',
      offer_price       TEXT NOT NULL DEFAULT '',
      website_url       TEXT NOT NULL DEFAULT '',
      whatsapp_url      TEXT NOT NULL DEFAULT '',
      contact_info      TEXT NOT NULL DEFAULT '',
      description       TEXT NOT NULL DEFAULT '',
      target_audience   TEXT NOT NULL DEFAULT '',
      language          TEXT NOT NULL DEFAULT 'English',
      cta               TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'draft',
      analysis_json     TEXT NOT NULL DEFAULT '{}',
      ai_provider       TEXT NOT NULL DEFAULT '',
      ai_model          TEXT NOT NULL DEFAULT '',
      scheduled_at      TEXT,
      timezone          TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS media_assets (
      id            TEXT PRIMARY KEY,
      campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      filename      TEXT NOT NULL,
      mime          TEXT NOT NULL,
      bytes         INTEGER NOT NULL,
      width         INTEGER,
      height        INTEGER,
      kind          TEXT NOT NULL DEFAULT 'image', -- image | video
      sha256        TEXT NOT NULL,
      alt_text      TEXT NOT NULL DEFAULT '',
      analysis_json TEXT NOT NULL DEFAULT '{}',
      deleted_at    TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_campaign ON media_assets(campaign_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_media_hash ON media_assets(sha256);

    CREATE TABLE IF NOT EXISTS media_derivatives (
      id         TEXT PRIMARY KEY,
      media_id   TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      platform_id TEXT,
      preset     TEXT NOT NULL,
      filename   TEXT NOT NULL,
      width      INTEGER,
      height     INTEGER,
      bytes      INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (media_id, preset)
    );

    CREATE TABLE IF NOT EXISTS generated_contents (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      platform_id     TEXT NOT NULL REFERENCES platforms(id),
      title           TEXT NOT NULL DEFAULT '',
      caption         TEXT NOT NULL DEFAULT '',
      description     TEXT NOT NULL DEFAULT '',
      hashtags_json   TEXT NOT NULL DEFAULT '[]',
      cta             TEXT NOT NULL DEFAULT '',
      destination_url TEXT NOT NULL DEFAULT '',
      alt_text        TEXT NOT NULL DEFAULT '',
      extra_json      TEXT NOT NULL DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'draft', -- draft | approved | rejected
      content_hash    TEXT NOT NULL DEFAULT '',
      generator       TEXT NOT NULL DEFAULT '',
      model           TEXT NOT NULL DEFAULT '',
      version         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE (campaign_id, platform_id)
    );

    CREATE TABLE IF NOT EXISTS publishing_jobs (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      platform_id     TEXT NOT NULL REFERENCES platforms(id),
      account_id      TEXT REFERENCES connected_accounts(id) ON DELETE SET NULL,
      media_id        TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
      content_id      TEXT REFERENCES generated_contents(id) ON DELETE SET NULL,
      scheduled_at    TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'scheduled',
      attempts        INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 3,
      idempotency_key TEXT NOT NULL UNIQUE,
      external_id     TEXT,
      published_url   TEXT,
      error           TEXT,
      error_code      TEXT,
      retryable       INTEGER NOT NULL DEFAULT 1,
      locked_at       TEXT,
      next_attempt_at TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_due ON publishing_jobs(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON publishing_jobs(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_platform ON publishing_jobs(platform_id, status);

    CREATE TABLE IF NOT EXISTS published_posts (
      id           TEXT PRIMARY KEY,
      job_id       TEXT NOT NULL REFERENCES publishing_jobs(id) ON DELETE CASCADE,
      campaign_id  TEXT NOT NULL,
      platform_id  TEXT NOT NULL,
      account_id   TEXT,
      external_id  TEXT,
      url          TEXT,
      published_at TEXT NOT NULL,
      verified     INTEGER NOT NULL DEFAULT 0,
      UNIQUE (job_id)
    );

    CREATE TABLE IF NOT EXISTS manual_tasks (
      id           TEXT PRIMARY KEY,
      campaign_id  TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      platform_id  TEXT NOT NULL REFERENCES platforms(id),
      content_id   TEXT REFERENCES generated_contents(id) ON DELETE SET NULL,
      status       TEXT NOT NULL DEFAULT 'pending', -- pending | copied | published | skipped
      notes        TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      UNIQUE (campaign_id, platform_id)
    );
    CREATE INDEX IF NOT EXISTS idx_manual_status ON manual_tasks(status);

    CREATE TABLE IF NOT EXISTS publishing_logs (
      id          TEXT PRIMARY KEY,
      job_id      TEXT,
      campaign_id TEXT,
      platform_id TEXT,
      level       TEXT NOT NULL DEFAULT 'info',
      step        TEXT NOT NULL,
      message     TEXT NOT NULL,
      meta_json   TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_job ON publishing_logs(job_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON publishing_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,          -- recurring_campaign | verify_accounts | cleanup
      campaign_id  TEXT,
      platform_id  TEXT,
      run_at       TEXT NOT NULL,
      frequency_hours INTEGER,
      status       TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_tasks(status, run_at);

    CREATE TABLE IF NOT EXISTS ai_activity_logs (
      id               TEXT PRIMARY KEY,
      user_id          TEXT,
      campaign_id      TEXT,
      kind             TEXT NOT NULL,
      provider         TEXT NOT NULL,
      model            TEXT NOT NULL DEFAULT '',
      ok               INTEGER NOT NULL DEFAULT 1,
      error            TEXT,
      prompt_tokens    INTEGER,
      completion_tokens INTEGER,
      meta_json        TEXT NOT NULL DEFAULT '{}',
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      action     TEXT NOT NULL,
      entity     TEXT NOT NULL DEFAULT '',
      entity_id  TEXT NOT NULL DEFAULT '',
      ip         TEXT NOT NULL DEFAULT '',
      meta_json  TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state        TEXT PRIMARY KEY,
      platform_id  TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      code_verifier TEXT,
      redirect_to  TEXT,
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key          TEXT PRIMARY KEY,
      count        INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_secrets (
      key         TEXT PRIMARY KEY,
      value_cipher TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    `,
  },
  {
    version: 2,
    name: 'campaign_recurrence',
    sql: `
    ALTER TABLE campaigns ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE campaigns ADD COLUMN next_recurrence_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_campaigns_recurrence ON campaigns(recurrence, next_recurrence_at);
    `,
  },
  {
    version: 3,
    name: 'worker_heartbeats',
    sql: `
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      id          TEXT PRIMARY KEY,
      source      TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      processed   INTEGER NOT NULL DEFAULT 0,
      recovered   INTEGER NOT NULL DEFAULT 0,
      recurrence  INTEGER NOT NULL DEFAULT 0,
      error       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_started ON worker_heartbeats(started_at DESC);
    `,
  },
  {
    version: 4,
    name: 'email_outreach',
    sql: `
    CREATE TABLE IF NOT EXISTS email_messages (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id   TEXT,
      to_address    TEXT NOT NULL,
      subject       TEXT NOT NULL,
      body          TEXT NOT NULL,
      template      TEXT NOT NULL DEFAULT 'custom',
      status        TEXT NOT NULL DEFAULT 'queued',
      error         TEXT,
      message_id    TEXT,
      accepted_json TEXT,
      rejected_json TEXT,
      created_at    TEXT NOT NULL,
      sent_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_email_messages_user ON email_messages(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS email_suppressions (
      email      TEXT PRIMARY KEY,
      reason     TEXT NOT NULL DEFAULT 'unsubscribed',
      created_at TEXT NOT NULL
    );
    `,
  },
];
