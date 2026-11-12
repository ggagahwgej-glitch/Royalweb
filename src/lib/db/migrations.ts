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
  {
    version: 5,
    name: 'onboarding_and_backups',
    sql: `
    -- Where a stored secret came from: 'dashboard' (typed by the operator),
    -- 'environment' (seeded from .env.local on first run) or 'backup' (imported).
    ALTER TABLE app_secrets ADD COLUMN source TEXT NOT NULL DEFAULT 'dashboard';

    -- One row per .env.local seeding run, so the UI can say exactly what was
    -- pre-filled and when, instead of silently trusting environment variables.
    CREATE TABLE IF NOT EXISTS env_seed_runs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT,
      trigger     TEXT NOT NULL DEFAULT 'first_run',   -- first_run | manual
      secrets     INTEGER NOT NULL DEFAULT 0,
      accounts    INTEGER NOT NULL DEFAULT 0,
      skipped_json TEXT NOT NULL DEFAULT '[]',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_env_seed_runs_created ON env_seed_runs(created_at DESC);

    -- Restored accounts keep the state they had in the backup, but are marked
    -- so the dashboard can ask for one live verification before publishing.
    ALTER TABLE connected_accounts ADD COLUMN restored_from_backup INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 6,
    name: 'workspaces_alerts_snapshots_rss_warmup',
    sql: `
    -- ── workspaces (agency mode) ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT 'gold',
      archived    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (user_id, slug)
    );
    ALTER TABLE users ADD COLUMN active_workspace_id TEXT;

    -- Business identity per workspace. Mirrors user_settings so a workspace can
    -- be a different client, and getSettings keeps working unchanged.
    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id            TEXT PRIMARY KEY,
      business_name           TEXT NOT NULL DEFAULT 'ROYALWEB',
      tagline                 TEXT NOT NULL DEFAULT '',
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

    ALTER TABLE campaigns ADD COLUMN workspace_id TEXT;
    ALTER TABLE media_assets ADD COLUMN workspace_id TEXT;
    ALTER TABLE connected_accounts ADD COLUMN workspace_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_workspace ON media_assets(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_accounts_workspace ON connected_accounts(workspace_id, platform_id);

    -- ── alerts ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS alert_events (
      id          TEXT PRIMARY KEY,
      workspace_id TEXT,
      code        TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'critical',   -- critical | warning
      title       TEXT NOT NULL,
      detail      TEXT NOT NULL DEFAULT '',
      meta_json   TEXT NOT NULL DEFAULT '{}',
      channel     TEXT NOT NULL DEFAULT '',            -- telegram | email | none
      delivered   INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events(created_at DESC);
    -- Dedupe: one alert per code per cooldown window, so a dead worker does not
    -- send a message every tick.
    CREATE TABLE IF NOT EXISTS alert_state (
      key           TEXT PRIMARY KEY,
      last_fired_at TEXT NOT NULL,
      count         INTEGER NOT NULL DEFAULT 0
    );

    -- ── full-database snapshots ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      file_name   TEXT NOT NULL,
      bytes       INTEGER NOT NULL,
      sha256      TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'full',       -- full | credentials
      trigger     TEXT NOT NULL DEFAULT 'manual',     -- manual | schedule
      tables_json TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at DESC);

    -- ── rss / blog ingestion ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS rss_feeds (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id    TEXT,
      url             TEXT NOT NULL,
      label           TEXT NOT NULL DEFAULT '',
      enabled         INTEGER NOT NULL DEFAULT 1,
      auto_generate   INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT,
      last_error      TEXT,
      last_item_at    TEXT,
      items_seen      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      UNIQUE (workspace_id, url)
    );
    CREATE TABLE IF NOT EXISTS rss_items (
      id           TEXT PRIMARY KEY,
      feed_id      TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
      guid_hash    TEXT NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      link         TEXT NOT NULL DEFAULT '',
      summary      TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      campaign_id  TEXT,
      state        TEXT NOT NULL DEFAULT 'new',       -- new | drafted | failed | skipped
      error        TEXT,
      created_at   TEXT NOT NULL,
      UNIQUE (feed_id, guid_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_rss_items_created ON rss_items(created_at DESC);

    -- Evergreen recycling: a finished campaign can be queued again later with a
    -- light variation instead of being republished verbatim.
    ALTER TABLE campaigns ADD COLUMN recycle_after_days INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE campaigns ADD COLUMN recycled_from TEXT;
    ALTER TABLE campaigns ADD COLUMN source_feed_id TEXT;

    -- ── email warm-up + reply detection ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS workspace_email_settings (
      workspace_id      TEXT PRIMARY KEY,
      smtp_host         TEXT NOT NULL DEFAULT '',
      smtp_port         INTEGER NOT NULL DEFAULT 587,
      smtp_user         TEXT NOT NULL DEFAULT '',
      smtp_pass_cipher  TEXT NOT NULL DEFAULT '',
      from_address      TEXT NOT NULL DEFAULT '',
      from_name         TEXT NOT NULL DEFAULT '',
      reply_to          TEXT NOT NULL DEFAULT '',
      postal_address    TEXT NOT NULL DEFAULT '',
      unsubscribe_url   TEXT NOT NULL DEFAULT '',
      ramp_enabled      INTEGER NOT NULL DEFAULT 1,
      ramp_start        INTEGER NOT NULL DEFAULT 5,
      ramp_increment    INTEGER NOT NULL DEFAULT 3,
      ramp_max          INTEGER NOT NULL DEFAULT 50,
      ramp_started_at   TEXT,
      imap_enabled      INTEGER NOT NULL DEFAULT 0,
      imap_host         TEXT NOT NULL DEFAULT '',
      imap_port         INTEGER NOT NULL DEFAULT 993,
      imap_user         TEXT NOT NULL DEFAULT '',
      imap_pass_cipher  TEXT NOT NULL DEFAULT '',
      imap_last_poll_at TEXT,
      imap_last_error   TEXT,
      updated_at        TEXT NOT NULL
    );
    ALTER TABLE email_messages ADD COLUMN workspace_id TEXT;
    -- Rows created before workspace scoping belong to the account's first workspace.
UPDATE connected_accounts SET workspace_id = (SELECT active_workspace_id FROM users ORDER BY created_at LIMIT 1)
  WHERE workspace_id IS NULL;
UPDATE campaigns SET workspace_id = (SELECT active_workspace_id FROM users ORDER BY created_at LIMIT 1)
  WHERE workspace_id IS NULL;
UPDATE media_assets SET workspace_id = (SELECT active_workspace_id FROM users ORDER BY created_at LIMIT 1)
  WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_workspace ON email_messages(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS email_send_daily (
      workspace_id TEXT NOT NULL,
      day          TEXT NOT NULL,
      sent         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, day)
    );
    CREATE TABLE IF NOT EXISTS email_replies (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT,
      from_address  TEXT NOT NULL,
      subject       TEXT NOT NULL DEFAULT '',
      snippet       TEXT NOT NULL DEFAULT '',
      received_at   TEXT NOT NULL,
      matched_to    TEXT,
      matched_id    TEXT,
      paused_followups INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      UNIQUE (workspace_id, from_address, received_at, subject)
    );
    CREATE INDEX IF NOT EXISTS idx_email_replies_created ON email_replies(created_at DESC);
    `,
  },
  {
    version: 7,
    name: 'deployment_indexes',
    sql: `
    -- Hot-path indexes for the lists the dashboard loads on every visit and for
    -- the query the cron-driven worker runs every minute on serverless hosting.
    CREATE INDEX IF NOT EXISTS idx_contents_campaign ON generated_contents(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_contents_platform ON generated_contents(platform_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_ready ON publishing_jobs(status, next_attempt_at, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alert_events_code ON alert_events(code, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_replies_workspace ON email_replies(workspace_id, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rss_items_feed ON rss_items(feed_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_send_daily_workspace ON email_send_daily(workspace_id, day);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_started ON worker_heartbeats(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at DESC);
    `,
  },
];
