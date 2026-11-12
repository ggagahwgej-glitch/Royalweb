import { z } from 'zod';

const urlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), { message: 'Must be a valid http(s) URL' });

export const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const setupSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  name: z.string().trim().min(1).max(120).default('ROYALWEB Admin'),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(160),
  businessCategory: z.string().trim().max(120).default(''),
  serviceName: z.string().trim().max(160).default(''),
  offerPrice: z.string().trim().max(80).default(''),
  websiteUrl: urlOrEmpty.default(''),
  whatsappUrl: urlOrEmpty.default(''),
  contactInfo: z.string().trim().max(300).default(''),
  description: z.string().trim().max(4000).default(''),
  targetAudience: z.string().trim().max(300).default(''),
  language: z.string().trim().max(40).default('English'),
  cta: z.string().trim().max(160).default(''),
  timezone: z.string().trim().max(80).default('Asia/Kolkata'),
  recurrence: z.enum(['none', 'daily', 'weekly']).default('none'),
});

export const campaignPatchSchema = campaignSchema.partial().extend({
  status: z.enum(['draft', 'ready', 'scheduled', 'paused', 'cancelled', 'completed']).optional(),
});

export const mediaPatchSchema = z.object({
  altText: z.string().trim().max(300).optional(),
  originalName: z.string().trim().min(1).max(200).optional(),
  campaignId: z.string().uuid().nullable().optional(),
});

export const contentPatchSchema = z.object({
  title: z.string().max(500).optional(),
  caption: z.string().max(12000).optional(),
  description: z.string().max(20000).optional(),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  cta: z.string().max(300).optional(),
  destinationUrl: z.string().max(500).optional(),
  altText: z.string().max(300).optional(),
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
});

export const accountSchema = z.object({
  platformId: z.string().min(1),
  accountName: z.string().trim().min(1).max(160),
  credentials: z.record(z.string().max(4000)).default({}),
});

export const settingsPatchSchema = z.object({
  businessName: z.string().trim().min(1).max(120).optional(),
  tagline: z.string().trim().max(200).optional(),
  businessDescription: z.string().trim().max(3000).optional(),
  services: z.array(z.string().trim().max(160)).max(40).optional(),
  targetCustomers: z.array(z.string().trim().max(160)).max(40).optional(),
  priceMin: z.string().trim().max(40).optional(),
  priceMax: z.string().trim().max(40).optional(),
  ctaPrimary: z.string().trim().max(160).optional(),
  ctaSecondary: z.string().trim().max(160).optional(),
  websiteUrl: z.string().trim().max(500).optional(),
  whatsappUrl: z.string().trim().max(500).optional(),
  contactEmail: z.string().trim().max(200).optional(),
  contactPhone: z.string().trim().max(60).optional(),
  publicContactVisible: z.boolean().optional(),
  defaultTimezone: z.string().trim().max(80).optional(),
  defaultLanguage: z.string().trim().max(40).optional(),
  aiProvider: z.string().trim().max(40).optional(),
  aiModel: z.string().trim().max(120).optional(),
  postingFrequencyHours: z.number().int().min(1).max(720).optional(),
  duplicateWindowHours: z.number().int().min(0).max(720).optional(),
  globalPause: z.boolean().optional(),
  autoPublishEnabled: z.boolean().optional(),
});

export const scheduleSchema = z.object({
  platforms: z.array(z.string().min(1)).min(1, 'Select at least one platform'),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().trim().max(80).default('Asia/Kolkata'),
  publishNow: z.boolean().default(false),
  perPlatformTimes: z.record(z.string()).optional(),
  recurrence: z.enum(['none', 'daily', 'weekly']).default('none'),
  requireApproved: z.boolean().default(true),
});

export const secretSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.string().max(4000),
});
