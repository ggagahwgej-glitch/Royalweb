import 'server-only';
import { json } from '@/lib/db';

type Row = Record<string, unknown>;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const b = (v: unknown) => Boolean(Number(v ?? 0));

export function campaignOut(r: Row) {
  return {
    id: s(r.id),
    name: s(r.name),
    status: s(r.status),
    businessCategory: s(r.business_category),
    serviceName: s(r.service_name),
    offerPrice: s(r.offer_price),
    websiteUrl: s(r.website_url),
    whatsappUrl: s(r.whatsapp_url),
    contactInfo: s(r.contact_info),
    description: s(r.description),
    targetAudience: s(r.target_audience),
    language: s(r.language),
    cta: s(r.cta),
    timezone: s(r.timezone),
    recurrence: s(r.recurrence || 'none'),
    nextRecurrenceAt: r.next_recurrence_at ? s(r.next_recurrence_at) : null,
    scheduledAt: r.scheduled_at ? s(r.scheduled_at) : null,
    analysis: json<Record<string, unknown>>(r.analysis_json as string, {}),
    aiProvider: s(r.ai_provider),
    aiModel: s(r.ai_model),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
    mediaCount: r.media_count !== undefined ? n(r.media_count) : undefined,
    jobCount: r.job_count !== undefined ? n(r.job_count) : undefined,
    publishedCount: r.published_count !== undefined ? n(r.published_count) : undefined,
    contentCount: r.content_count !== undefined ? n(r.content_count) : undefined,
    approvedCount: r.approved_count !== undefined ? n(r.approved_count) : undefined,
  };
}

export function contentOut(r: Row) {
  return {
    id: s(r.id),
    campaignId: s(r.campaign_id),
    platformId: s(r.platform_id),
    platformName: r.platform_name ? s(r.platform_name) : undefined,
    automation: r.automation ? s(r.automation) : undefined,
    title: s(r.title),
    caption: s(r.caption),
    description: s(r.description),
    hashtags: json<string[]>(r.hashtags_json as string, []),
    cta: s(r.cta),
    destinationUrl: s(r.destination_url),
    altText: s(r.alt_text),
    extra: json<Record<string, unknown>>(r.extra_json as string, {}),
    status: s(r.status),
    generator: s(r.generator),
    model: s(r.model),
    version: n(r.version) ?? 1,
    updatedAt: s(r.updated_at),
  };
}

export function jobOut(r: Row) {
  return {
    id: s(r.id),
    campaignId: s(r.campaign_id),
    campaignName: r.campaign_name ? s(r.campaign_name) : undefined,
    platformId: s(r.platform_id),
    platformName: r.platform_name ? s(r.platform_name) : undefined,
    automation: r.automation ? s(r.automation) : undefined,
    accountId: r.account_id ? s(r.account_id) : null,
    accountName: r.account_name ? s(r.account_name) : null,
    contentId: r.content_id ? s(r.content_id) : null,
    status: s(r.status),
    scheduledAt: s(r.scheduled_at),
    attempts: n(r.attempts) ?? 0,
    maxAttempts: n(r.max_attempts) ?? 3,
    error: r.error ? s(r.error) : null,
    errorCode: r.error_code ? s(r.error_code) : null,
    retryable: b(r.retryable),
    retryInMinutes: r.next_attempt_at ? Math.max(0, Math.round((new Date(s(r.next_attempt_at)).getTime() - Date.now()) / 60000)) : null,
    publishedUrl: r.published_url ? s(r.published_url) : null,
    externalId: r.external_id ? s(r.external_id) : null,
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export function mediaOut(r: Row) {
  return {
    id: s(r.id),
    campaignId: r.campaign_id ? s(r.campaign_id) : null,
    campaignName: r.campaign_name ? s(r.campaign_name) : null,
    originalName: s(r.original_name),
    mime: s(r.mime),
    bytes: n(r.bytes) ?? 0,
    width: n(r.width),
    height: n(r.height),
    kind: s(r.kind),
    altText: s(r.alt_text),
    sha256: s(r.sha256),
    analysis: json<Record<string, unknown>>(r.analysis_json as string, {}),
    derivativeCount: n(r.derivative_count) ?? 0,
    createdAt: s(r.created_at),
    deletedAt: r.deleted_at ? s(r.deleted_at) : null,
    fileUrl: `/api/media/${s(r.id)}/file`,
    thumbUrl: `/api/media/${s(r.id)}/file?variant=thumb`,
  };
}

export function accountOut(r: Row) {
  // NOTE: credentials_cipher is intentionally never exposed.
  return {
    id: s(r.id),
    platformId: s(r.platform_id),
    platformName: r.platform_name ? s(r.platform_name) : undefined,
    automation: r.automation ? s(r.automation) : undefined,
    accountName: s(r.account_name),
    externalId: r.external_id ? s(r.external_id) : null,
    scopes: s(r.scopes),
    status: s(r.status),
    tokenExpiresAt: r.token_expires_at ? s(r.token_expires_at) : null,
    lastVerifiedAt: r.last_verified_at ? s(r.last_verified_at) : null,
    lastError: r.last_error ? s(r.last_error) : null,
    meta: json<Record<string, unknown>>(r.meta_json as string, {}),
    createdAt: s(r.created_at),
  };
}

export function manualOut(r: Row) {
  return {
    id: s(r.id),
    campaignId: s(r.campaign_id),
    campaignName: r.campaign_name ? s(r.campaign_name) : undefined,
    platformId: s(r.platform_id),
    platformName: r.platform_name ? s(r.platform_name) : undefined,
    contentId: r.content_id ? s(r.content_id) : null,
    status: s(r.status),
    notes: s(r.notes),
    completedAt: r.completed_at ? s(r.completed_at) : null,
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

export function platformOut(r: Row) {
  return {
    id: s(r.id),
    name: s(r.name),
    group: s(r.grp),
    automation: s(r.automation),
    integration: s(r.integration),
    docsUrl: s(r.docs_url),
    enabled: b(r.enabled),
    credentialStatus: s(r.credential_status),
    lastActivityAt: r.last_activity_at ? s(r.last_activity_at) : null,
    lastError: r.last_error ? s(r.last_error) : null,
    lastErrorAt: r.last_error_at ? s(r.last_error_at) : null,
    notes: s(r.notes),
    sortOrder: n(r.sort_order) ?? 0,
    accountCount: n(r.account_count) ?? 0,
    publishedCount: n(r.published_count) ?? 0,
    failedCount: n(r.failed_count) ?? 0,
    scheduledCount: n(r.scheduled_count) ?? 0,
  };
}
