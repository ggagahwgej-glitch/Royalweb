'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Copy, Info, Loader2, X } from 'lucide-react';

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ Card

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}) {
  return <Tag className={cn('card', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <div className="mt-0.5 text-gold-400">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink-100">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-400">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------- Buttons

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'gold' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-[0.5px]';
  const sizes = {
    sm: 'px-3 py-1.5 text-[12.5px]',
    md: 'px-4 py-2.5 text-[13.5px]',
    lg: 'px-5 py-3 text-[14.5px]',
  };
  const variants = {
    gold: 'bg-gradient-to-b from-gold-300 to-gold-500 text-obsidian-950 shadow-gold hover:from-gold-200 hover:to-gold-400',
    secondary: 'border border-white/[0.09] bg-white/[0.045] text-ink-100 hover:border-white/[0.16] hover:bg-white/[0.075]',
    outline: 'border border-gold-500/40 bg-transparent text-gold-200 hover:bg-gold-500/10',
    ghost: 'text-ink-300 hover:bg-white/[0.05] hover:text-ink-100',
    danger: 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20',
  };
  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Badge

export type Tone = 'gold' | 'green' | 'red' | 'amber' | 'blue' | 'neutral' | 'purple';

export function Badge({
  children,
  tone = 'neutral',
  dot,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    gold: 'border-gold-500/30 bg-gold-500/10 text-gold-200',
    green: 'border-ok/25 bg-ok/10 text-ok',
    red: 'border-danger/30 bg-danger/10 text-danger',
    amber: 'border-warn/30 bg-warn/10 text-warn',
    blue: 'border-info/30 bg-info/10 text-info',
    purple: 'border-[#a78bd8]/30 bg-[#a78bd8]/10 text-[#c3aee8]',
    neutral: 'border-white/[0.08] bg-white/[0.04] text-ink-300',
  };
  const dotTone: Record<Tone, string> = {
    gold: 'bg-gold-400',
    green: 'bg-ok',
    red: 'bg-danger',
    amber: 'bg-warn',
    blue: 'bg-info',
    purple: 'bg-[#a78bd8]',
    neutral: 'bg-ink-400',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11px] font-medium',
        tones[tone],
        className
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dotTone[tone])} /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  published: 'green',
  completed: 'green',
  connected: 'green',
  approved: 'green',
  ready: 'green',
  scheduled: 'gold',
  publishing: 'blue',
  processing: 'blue',
  draft: 'neutral',
  paused: 'amber',
  pending: 'amber',
  waiting_approval: 'amber',
  manual_required: 'amber',
  duplicate_prevented: 'amber',
  failed: 'red',
  connection_expired: 'red',
  error: 'red',
  expired: 'red',
  cancelled: 'neutral',
  revoked: 'neutral',
  skipped: 'neutral',
  not_connected: 'neutral',
  needs_configuration: 'purple',
  unverified: 'amber',
  manual: 'purple',
  copied: 'blue',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONES[status] ?? 'neutral';
  const label = status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Connection Expired', 'CONNECTION EXPIRED')
    .replace('Manual Required', 'MANUAL ACTION REQUIRED');
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}

// ------------------------------------------------------------------ Inputs

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      {label ? (
        <span className="field-label">
          {label} {required ? <span className="text-gold-400">*</span> : null}
        </span>
      ) : null}
      {children}
      {hint && !error ? <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-500">{hint}</span> : null}
      {error ? <span className="mt-1 block text-[11.5px] text-danger">{error}</span> : null}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn('input', className)} {...rest} />;
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn('input min-h-[96px] resize-y leading-relaxed', className)} {...rest} />;
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn('input appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
    );
  }
);

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {label ? <div className="text-[13.5px] font-medium text-ink-100">{label}</div> : null}
        {description ? <div className="mt-0.5 text-[12px] leading-relaxed text-ink-400">{description}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-gold-500/50 bg-gold-500/80' : 'border-white/10 bg-white/[0.06]',
          disabled && 'opacity-50'
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] h-4 w-4 rounded-full transition-all',
            checked ? 'left-[24px] bg-obsidian-950' : 'left-[3px] bg-ink-300'
          )}
        />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Layout bits

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-gold-500">{eyebrow}</div>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink-100 sm:text-[26px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: React.ReactNode;
}) {
  const glow: Record<Tone, string> = {
    gold: 'text-gold-300',
    green: 'text-ok',
    red: 'text-danger',
    amber: 'text-warn',
    blue: 'text-info',
    purple: 'text-[#c3aee8]',
    neutral: 'text-ink-100',
  };
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-400">{label}</span>
        {icon ? <span className="text-ink-500">{icon}</span> : null}
      </div>
      <div className={cn('mt-2 text-[26px] font-semibold leading-none tracking-tight', glow[tone])}>{value}</div>
      {hint ? <div className="mt-1.5 text-[11.5px] text-ink-500">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-ink-500">{icon}</div> : null}
      <h3 className="text-[14px] font-medium text-ink-200">{title}</h3>
      {description ? <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-ink-400">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-400">
      <Loader2 size={15} className="animate-spin text-gold-400" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  const tones: Record<Tone, string> = {
    gold: 'border-gold-500/25 bg-gold-500/[0.07] text-gold-100',
    green: 'border-ok/25 bg-ok/[0.07] text-[#bfe9da]',
    red: 'border-danger/25 bg-danger/[0.07] text-[#f0c2c5]',
    amber: 'border-warn/25 bg-warn/[0.07] text-[#f0dcb6]',
    blue: 'border-info/25 bg-info/[0.07] text-[#c6dcf5]',
    purple: 'border-[#a78bd8]/25 bg-[#a78bd8]/[0.07] text-[#ded1f2]',
    neutral: 'border-white/[0.08] bg-white/[0.03] text-ink-300',
  };
  const Icon = tone === 'red' ? AlertCircle : tone === 'green' ? CheckCircle2 : Info;
  return (
    <div className={cn('flex gap-3 rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed', tones[tone])}>
      <Icon size={16} className="mt-0.5 shrink-0 opacity-80" />
      <div className="min-w-0">
        {title ? <div className="mb-1 font-medium">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Toasts

type ToastItem = { id: number; message: string; tone: 'success' | 'error' | 'info' };
const ToastContext = createContext<{ push: (message: string, tone?: ToastItem['tone']) => void }>({
  push: () => undefined,
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 5200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-5">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-[12.5px] shadow-2xl backdrop-blur-md',
              item.tone === 'success'
                ? 'border-ok/30 bg-[#0e1a16]/95 text-[#c8e9dd]'
                : item.tone === 'error'
                  ? 'border-danger/30 bg-[#1a0f11]/95 text-[#f2c9cc]'
                  : 'border-white/10 bg-obsidian-800/95 text-ink-200'
            )}
          >
            {item.tone === 'success' ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
            ) : item.tone === 'error' ? (
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
            ) : (
              <Info size={15} className="mt-0.5 shrink-0 text-gold-400" />
            )}
            <span className="flex-1">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ------------------------------------------------------------------ Modal

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-obsidian-850 shadow-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        )}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-ink-100">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-white/5 hover:text-ink-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-white/[0.07] px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Copy

export function CopyButton({
  value,
  label = 'Copy',
  className,
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      push('Copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      push('Copy failed — select the text manually.', 'error');
    }
  }
  return (
    <Button size={size} variant="secondary" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />} className={className}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

// ------------------------------------------------------------------ API helper

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'x-royalweb-request': '1' };
  let body: BodyInit | undefined;
  if (options.formData) body = options.formData;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const res = await fetch(path, {
    method: options.method ?? (options.body || options.formData ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: { ok?: boolean; data?: T; error?: string; code?: string; detail?: unknown } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected response (${res.status})`);
  }
  if (!res.ok || data.ok === false) {
    const detail =
      Array.isArray(data.detail) && data.detail.length
        ? ` (${(data.detail as { message?: string }[]).map((d) => d.message).join('; ')})`
        : '';
    throw new Error(`${data.error ?? `Request failed (${res.status})`}${detail}`);
  }
  return (data.data ?? data) as T;
}

export function useApiAction() {
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, successMessage?: string): Promise<T | null> => {
      setBusy(key);
      try {
        const result = await fn();
        if (successMessage) push(successMessage, 'success');
        return result;
      } catch (err) {
        push((err as Error).message, 'error');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [push]
  );
  return { busy, run };
}

export function ProgressBar({ value, total, tone = 'gold' }: { value: number; total: number; tone?: Tone }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const colors: Record<Tone, string> = {
    gold: 'bg-gold-500',
    green: 'bg-ok',
    red: 'bg-danger',
    amber: 'bg-warn',
    blue: 'bg-info',
    purple: 'bg-[#a78bd8]',
    neutral: 'bg-ink-400',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={cn('h-full rounded-full transition-all', colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
