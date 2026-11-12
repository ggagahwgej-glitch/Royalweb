import 'server-only';

/** Shared HTTP utilities for platform adapters. */

export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
  headers: Headers;
}

const DEFAULT_TIMEOUT = 25_000;

export async function http(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<HttpResult> {
  const { timeoutMs = DEFAULT_TIMEOUT, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal, cache: 'no-store' });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data: data as never, text, headers: res.headers };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `Request to ${safeHost(url)} timed out after ${timeoutMs}ms`
        : `Network error contacting ${safeHost(url)}: ${(err as Error).message}`;
    return {
      ok: false,
      status: 0,
      data: null,
      text: message,
      headers: new Headers(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'endpoint';
  }
}

export function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

export async function httpJson<T = unknown>(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}
): Promise<HttpResult<T>> {
  const result = await http(url, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    timeoutMs: opts.timeoutMs,
  });
  return result as HttpResult<T>;
}

/** Pull a human-readable error message out of an arbitrary API error body. */
export function errorMessage(res: HttpResult): string {
  const d = res.data as Record<string, any> | string | null;
  if (d && typeof d === 'object') {
    if (typeof d.error === 'string') return d.error;
    if (d.error && typeof d.error === 'object') {
      if (typeof d.error.message === 'string') return d.error.message;
      if (Array.isArray(d.error.errors) && d.error.errors[0]?.message)
        return d.error.errors[0].message;
    }
    if (Array.isArray(d.errors) && d.errors[0]?.message) return d.errors[0].message;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.error_description === 'string') return d.error_description;
    if (Array.isArray(d.errors) && typeof d.errors[0] === 'string') return d.errors[0];
    try {
      return JSON.stringify(d).slice(0, 400);
    } catch {
      /* fall through */
    }
  }
  if (typeof d === 'string' && d.trim()) return d.slice(0, 400);
  return `HTTP ${res.status}`;
}

export interface ClassifiedError {
  message: string;
  code: string;
  retryable: boolean;
  /** True when the stored account credentials are no longer valid. */
  authError: boolean;
}

export function classify(res: HttpResult, context: string): ClassifiedError {
  const msg = errorMessage(res);
  const status = res.status;
  if (status === 0) {
    return { message: `${context}: ${msg}`, code: 'network_error', retryable: true, authError: false };
  }
  if (status === 401) {
    return {
      message: `${context}: credentials rejected (HTTP 401). Reconnect this account. ${msg}`,
      code: 'auth_expired',
      retryable: false,
      authError: true,
    };
  }
  if (status === 403) {
    return {
      message: `${context}: permission denied (HTTP 403). The connected account lacks the required scope. ${msg}`,
      code: 'permission_denied',
      retryable: false,
      authError: false,
    };
  }
  if (status === 429) {
    return {
      message: `${context}: rate limited by the platform (HTTP 429). ${msg}`,
      code: 'rate_limited',
      retryable: true,
      authError: false,
    };
  }
  if (status === 404) {
    return {
      message: `${context}: endpoint or resource not found (HTTP 404). ${msg}`,
      code: 'not_found',
      retryable: false,
      authError: false,
    };
  }
  if (status >= 500) {
    return {
      message: `${context}: platform server error (HTTP ${status}). ${msg}`,
      code: 'platform_error',
      retryable: true,
      authError: false,
    };
  }
  return {
    message: `${context}: ${msg}`,
    code: 'request_rejected',
    retryable: false,
    authError: false,
  };
}

export function publishedUrlOrNull(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//.test(value) ? value : undefined;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Compose the body text adapters send: caption + CTA + links + hashtags. */
export function composePostBody(
  caption: string,
  opts: { cta?: string; url?: string; whatsapp?: string; hashtags?: string[]; maxLength?: number; includeTags?: boolean }
): string {
  const parts = [caption.trim()];
  if (opts.cta && !caption.toLowerCase().includes(opts.cta.toLowerCase())) parts.push(opts.cta);
  if (opts.url && !caption.includes(opts.url)) parts.push(opts.url);
  if (opts.whatsapp && opts.whatsapp !== opts.url && !caption.includes(opts.whatsapp)) {
    parts.push(`WhatsApp: ${opts.whatsapp}`);
  }
  if (opts.includeTags !== false && opts.hashtags?.length) {
    parts.push(opts.hashtags.slice(0, 10).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' '));
  }
  let body = parts.filter(Boolean).join('\n\n');
  if (opts.maxLength) body = truncate(body, opts.maxLength);
  return body;
}

export function formData(fields: Record<string, string | undefined | null>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) params.set(k, v);
  return params;
}

export function normalizeHashtags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.replace(/^#/, '').replace(/[^A-Za-z0-9_]/g, '').trim()).filter(Boolean))];
}
