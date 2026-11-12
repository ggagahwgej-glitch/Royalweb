import 'server-only';
import { get, run, nowIso } from '@/lib/db';
import type { BusinessProfile } from '@/lib/platforms/types';

export interface AppSettings {
  userId: string;
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

export function getSettings(userId: string): AppSettings {
  let row = get<Row>('SELECT * FROM user_settings WHERE user_id = ?', userId);
  if (!row) {
    const ts = nowIso();
    run(
      `INSERT INTO user_settings (user_id, business_name, tagline, business_description, services_json,
        target_customers_json, price_min, price_max, cta_primary, cta_secondary, website_url, whatsapp_url,
        contact_email, contact_phone, public_contact_visible, updated_at)
       VALUES (?, 'ROYALWEB', 'Website Design & Development', '', '[]', '[]', '2999', '4999',
        'Get Your Business Website', 'Contact Us / WhatsApp Enquiry', '', '', '', '', 0, ?)`,
      userId,
      ts
    );
    row = get<Row>('SELECT * FROM user_settings WHERE user_id = ?', userId)!;
  }
  return {
    userId,
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

export function updateSettings(userId: string, patch: Record<string, unknown>) {
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
  if (!assignments.length) return getSettings(userId);
  assignments.push('updated_at = ?');
  values.push(nowIso(), userId);
  run(`UPDATE user_settings SET ${assignments.join(', ')} WHERE user_id = ?`, ...values);
  return getSettings(userId);
}

export function publicContactLine(settings: AppSettings): string {
  if (!settings.publicContactVisible) return '';
  return [settings.contactEmail, settings.contactPhone].filter(Boolean).join(' · ');
}
