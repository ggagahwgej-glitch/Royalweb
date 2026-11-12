import 'server-only';
import { get, run, nowIso } from '@/lib/db';
import { activeWorkspace } from '@/lib/workspace';
import type { BusinessProfile } from '@/lib/platforms/types';

export interface AppSettings {
  userId: string;
  workspaceId: string;
  businessName: string;
  tagline: string;
  businessDescription: string;
  services: string[];
  targetCustomers: string[];
  priceMin: string;
  priceMax: string;
  ctaPrimary: string;
  ctaSecondary: string;
  websiteUrl: string;
  whatsappUrl: string;
  contactEmail: string;
  contactPhone: string;
  publicContactVisible: boolean;
  defaultTimezone: string;
  defaultLanguage: string;
  aiProvider: string;
  aiModel: string;
  postingFrequencyHours: number;
  duplicateWindowHours: number;
  globalPause: boolean;
  autoPublishEnabled: boolean;
  updatedAt: string;
}

interface Row {
  [key: string]: unknown;
}

function parseList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Settings belong to the *active workspace*, not to the user: an agency client
 * keeps their own business identity. The legacy `user_settings` row is used
 * only as the seed for a workspace that has none yet.
 */
export function getSettings(userId: string, workspaceId?: string): AppSettings {
  const workspace = workspaceId ? null : activeWorkspace(userId);
  const wsId = workspaceId ?? workspace!.id;
  let row = get<Row>('SELECT * FROM workspace_settings WHERE workspace_id = ?', wsId);
  if (!row) {
    const seed = get<Row>('SELECT * FROM user_settings WHERE user_id = ?', userId);
    const ts = nowIso();
    run(
      `INSERT INTO workspace_settings (workspace_id, business_name, tagline, business_description, services_json,
        target_customers_json, price_min, price_max, cta_primary, cta_secondary, website_url, whatsapp_url,
        contact_email, contact_phone, public_contact_visible, default_timezone, default_language, ai_provider,
        ai_model, posting_frequency_hours, duplicate_window_hours, global_pause, auto_publish_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO NOTHING`,
      wsId,
      String(seed?.business_name ?? 'ROYALWEB'),
      String(seed?.tagline ?? 'Website Design & Development'),
      String(seed?.business_description ?? ''),
      String(seed?.services_json ?? '[]'),
      String(seed?.target_customers_json ?? '[]'),
      String(seed?.price_min ?? '2999'),
      String(seed?.price_max ?? '4999'),
      String(seed?.cta_primary ?? 'Get Your Business Website'),
      String(seed?.cta_secondary ?? 'Contact Us / WhatsApp Enquiry'),
      String(seed?.website_url ?? ''),
      String(seed?.whatsapp_url ?? ''),
      String(seed?.contact_email ?? ''),
      String(seed?.contact_phone ?? ''),
      Number(seed?.public_contact_visible ?? 0),
      String(seed?.default_timezone ?? 'Asia/Kolkata'),
      String(seed?.default_language ?? 'English'),
      String(seed?.ai_provider ?? 'auto'),
      String(seed?.ai_model ?? ''),
      Number(seed?.posting_frequency_hours ?? 24),
      Number(seed?.duplicate_window_hours ?? 72),
      Number(seed?.global_pause ?? 0),
      Number(seed?.auto_publish_enabled ?? 1),
      ts
    );
    row = get<Row>('SELECT * FROM workspace_settings WHERE workspace_id = ?', wsId)!;
  }
  return {
    userId,
    workspaceId: wsId,
    businessName: String(row.business_name ?? 'ROYALWEB'),
    tagline: String(row.tagline ?? ''),
    businessDescription: String(row.business_description ?? ''),
    services: parseList(row.services_json),
    targetCustomers: parseList(row.target_customers_json),
    priceMin: String(row.price_min ?? ''),
    priceMax: String(row.price_max ?? ''),
    ctaPrimary: String(row.cta_primary ?? ''),
    ctaSecondary: String(row.cta_secondary ?? ''),
    websiteUrl: String(row.website_url ?? ''),
    whatsappUrl: String(row.whatsapp_url ?? ''),
    contactEmail: String(row.contact_email ?? ''),
    contactPhone: String(row.contact_phone ?? ''),
    publicContactVisible: Boolean(Number(row.public_contact_visible ?? 0)),
    defaultTimezone: String(row.default_timezone ?? 'Asia/Kolkata'),
    defaultLanguage: String(row.default_language ?? 'English'),
    aiProvider: String(row.ai_provider ?? 'auto'),
    aiModel: String(row.ai_model ?? ''),
    postingFrequencyHours: Number(row.posting_frequency_hours ?? 24),
    duplicateWindowHours: Number(row.duplicate_window_hours ?? 72),
    globalPause: Boolean(Number(row.global_pause ?? 0)),
    autoPublishEnabled: Boolean(Number(row.auto_publish_enabled ?? 1)),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export function businessProfile(settings: AppSettings): BusinessProfile {
  return {
    businessName: settings.businessName,
    tagline: settings.tagline,
    websiteUrl: settings.websiteUrl,
    // Personal contact details are only ever exposed when explicitly approved.
    whatsappUrl: settings.publicContactVisible ? settings.whatsappUrl : '',
    contactEmail: settings.publicContactVisible ? settings.contactEmail : '',
    contactPhone: settings.publicContactVisible ? settings.contactPhone : '',
    publicContactVisible: settings.publicContactVisible,
    services: settings.services,
    targetCustomers: settings.targetCustomers,
    priceMin: settings.priceMin,
    priceMax: settings.priceMax,
    ctaPrimary: settings.ctaPrimary,
    ctaSecondary: settings.ctaSecondary,
  };
}

export const SETTING_COLUMNS: Record<string, { column: string; type: 'string' | 'number' | 'boolean' | 'json' }> = {
  businessName: { column: 'business_name', type: 'string' },
  tagline: { column: 'tagline', type: 'string' },
  businessDescription: { column: 'business_description', type: 'string' },
  services: { column: 'services_json', type: 'json' },
  targetCustomers: { column: 'target_customers_json', type: 'json' },
  priceMin: { column: 'price_min', type: 'string' },
  priceMax: { column: 'price_max', type: 'string' },
  ctaPrimary: { column: 'cta_primary', type: 'string' },
  ctaSecondary: { column: 'cta_secondary', type: 'string' },
  websiteUrl: { column: 'website_url', type: 'string' },
  whatsappUrl: { column: 'whatsapp_url', type: 'string' },
  contactEmail: { column: 'contact_email', type: 'string' },
  contactPhone: { column: 'contact_phone', type: 'string' },
  publicContactVisible: { column: 'public_contact_visible', type: 'boolean' },
  defaultTimezone: { column: 'default_timezone', type: 'string' },
  defaultLanguage: { column: 'default_language', type: 'string' },
  aiProvider: { column: 'ai_provider', type: 'string' },
  aiModel: { column: 'ai_model', type: 'string' },
  postingFrequencyHours: { column: 'posting_frequency_hours', type: 'number' },
  duplicateWindowHours: { column: 'duplicate_window_hours', type: 'number' },
  globalPause: { column: 'global_pause', type: 'boolean' },
  autoPublishEnabled: { column: 'auto_publish_enabled', type: 'boolean' },
};

export function updateSettings(userId: string, patch: Record<string, unknown>, workspaceId?: string) {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const spec = SETTING_COLUMNS[key];
    if (!spec || value === undefined) continue;
    assignments.push(`${spec.column} = ?`);
    if (spec.type === 'json') values.push(JSON.stringify(value));
    else if (spec.type === 'boolean') values.push(value ? 1 : 0);
    else if (spec.type === 'number') values.push(Number(value));
    else values.push(String(value));
  }
  if (!assignments.length) return getSettings(userId, workspaceId);
  const wsId = workspaceId ?? getSettings(userId).workspaceId;
  assignments.push('updated_at = ?');
  values.push(nowIso(), wsId);
  run(`UPDATE workspace_settings SET ${assignments.join(', ')} WHERE workspace_id = ?`, ...values);
  return getSettings(userId, wsId);
}

export function publicContactLine(settings: AppSettings): string {
  if (!settings.publicContactVisible) return '';
  return [settings.contactEmail, settings.contactPhone].filter(Boolean).join(' · ');
}
