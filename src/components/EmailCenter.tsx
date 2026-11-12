'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BadgeCheck,
  ClipboardCopy,
  Mail,
  MailCheck,
  Send,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@/components/ui';
import { OUTREACH_ETHICS, QUALITY_RULES } from '@/lib/ai/expertise';
import { relativeTime } from '@/lib/time';

interface Config {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  postalAddress: string;
  unsubscribeUrl: string;
  missing: string[];
}

interface TemplateMeta {
  id: 'intro' | 'follow_up' | 'proposal' | 'campaign_announcement' | 'review_request' | 'custom';
  label: string;
  purpose: string;
  requiresConsent: boolean;
}

interface Message {
  id: string;
  to_address: string;
  subject: string;
  body: string;
  template: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

interface Payload {
  config: Config;
  advice: { level: 'ok' | 'warn'; text: string }[];
  messages: Message[];
  suppressions: number;
  sentCount: number;
  templates: TemplateMeta[];
}

const EMPTY_FORM = {
  host: '',
  port: '587',
  user: '',
  pass: '',
  fromAddress: '',
  fromName: '',
  replyTo: '',
  postalAddress: '',
  unsubscribeUrl: '',
};

export function EmailCenter() {
  const { push } = useToast();
  const params = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [tab, setTab] = useState<'compose' | 'setup' | 'history'>('compose');

  const [template, setTemplate] = useState<TemplateMeta['id']>('intro');
  const [recipientName, setRecipientName] = useState('');
  const [recipientBusiness, setRecipientBusiness] = useState('');
  const [to, setTo] = useState('');
  const [brief, setBrief] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftNotices, setDraftNotices] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<Payload>('/api/email');
      setData(payload);
      setForm({
        host: payload.config.host,
        port: String(payload.config.port || 587),
        user: payload.config.user,
        pass: '',
        fromAddress: payload.config.fromAddress,
        fromName: payload.config.fromName,
        replyTo: payload.config.replyTo,
        postalAddress: payload.config.postalAddress,
        unsubscribeUrl: payload.config.unsubscribeUrl,
      });
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const preset = params.get('template') as TemplateMeta['id'] | null;
    if (preset) setTemplate(preset);
    const presetTo = params.get('to');
    if (presetTo) setTo(presetTo);
    const presetName = params.get('name');
    if (presetName) setRecipientName(presetName);
  }, [params]);

  const activeTemplate = useMemo(
    () => data?.templates.find((t) => t.id === template),
    [data, template]
  );

  async function saveConfig() {
    setSaving(true);
    setVerifyResult(null);
    try {
      const res = await api<{ config: Config; verification: { ok: boolean; message: string } | null }>(
        '/api/email/config',
        { method: 'POST', body: { ...form, port: Number(form.port) } }
      );
      setData((prev) => (prev ? { ...prev, config: { ...prev.config, ...res.config } } : prev));
      setForm((f) => ({ ...f, pass: '' }));
      if (res.verification) {
        setVerifyResult(res.verification);
        push(res.verification.ok ? 'SMTP verified' : 'SMTP details saved, but the login failed', res.verification.ok ? 'success' : 'error');
      } else {
        push('Saved — some fields are still missing', 'info');
      }
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api<{ ok: boolean; message: string }>('/api/email/verify', { method: 'POST', body: {} });
      setVerifyResult(res);
      push(res.ok ? 'SMTP verified' : 'Verification failed — read the reason', res.ok ? 'success' : 'error');
    } catch (err) {
      setVerifyResult({ ok: false, message: (err as Error).message });
      push((err as Error).message, 'error');
    } finally {
      setVerifying(false);
    }
  }

  async function draft() {
    setDrafting(true);
    setDraftNotices([]);
    try {
      const res = await api<{ subject: string; body: string; mode: string; notices: string[] }>('/api/email/draft', {
        method: 'POST',
        body: { template, recipientName, recipientBusiness, brief },
      });
      setSubject(res.subject);
      setBody(res.body);
      setDraftNotices([...(res.mode === 'ai' ? ['Rewritten by your AI provider from verified facts only.'] : []), ...res.notices]);
      setTab('compose');
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await api<{ result: { ok: boolean; status: string; message: string } }>('/api/email/send', {
        method: 'POST',
        body: { to, subject, body, template },
      });
      setSendResult({ ok: res.result.ok, message: res.result.message });
      push(res.result.ok ? 'Accepted by the mail server' : 'Not sent — see the reason', res.result.ok ? 'success' : 'error');
      await load();
    } catch (err) {
      setSendResult({ ok: false, message: (err as Error).message });
      push((err as Error).message, 'error');
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  async function suppress(email: string) {
    try {
      await api('/api/email/suppress', { method: 'POST', body: { email, reason: 'operator added from history' } });
      push(`${email} will never be emailed again`, 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }

  if (!data) {
    return (
      <div className="py-16">
        <Spinner label="Loading email centre…" />
      </div>
    );
  }

  const config = data.config;
  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'compose', label: 'Compose' },
    { id: 'setup', label: 'Sending setup' },
    { id: 'history', label: `History (${data.messages.length})` },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Direct outreach"
        title="Email"
        description="Send from an address you own and verify. ROYALWEB writes the draft, proves the SMTP handshake, and records exactly what the mail server accepted."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={config.configured ? 'green' : 'amber'} dot>
              {config.configured ? 'SMTP configured' : 'not configured'}
            </Badge>
            <Badge tone="neutral">{data.sentCount} sent</Badge>
            <Badge tone="purple">{data.suppressions} opted out</Badge>
          </div>
        }
      />

      <Notice tone="neutral" title="No invented identity">
        Mail is sent from <span className="text-ink-200">{config.fromAddress || 'your own verified address'}</span> with your
        business name in the footer. There is no fake mailbox, no spoofed display name and no throwaway sender — those are
        the things that get a business marked as spam. Nothing is sent until you press Send.
      </Notice>

      <div className="mt-4 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[12px] transition-colors',
              tab === t.id ? 'bg-gold-500/15 text-gold-200' : 'text-ink-400 hover:text-ink-200'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' ? (
        <div className="mt-3 grid gap-4 xl:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader
              title="SMTP"
              subtitle="Use your domain mailbox or a transactional provider. Port 465 = implicit TLS, 587 = STARTTLS."
              icon={<ServerCog size={16} />}
            />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <Field label="SMTP host">
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.yourdomain.com" />
              </Field>
              <Field label="Port">
                <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="587" />
              </Field>
              <Field label="Username">
                <Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="you@yourdomain.com" />
              </Field>
              <Field label="Password / app password" hint={config.hasPassword ? 'Stored encrypted — leave blank to keep it' : 'Use an app password, never your login password'}>
                <Input
                  type="password"
                  value={form.pass}
                  onChange={(e) => setForm({ ...form, pass: e.target.value })}
                  placeholder={config.hasPassword ? '••••••••' : 'app password'}
                />
              </Field>
              <Field label="From address">
                <Input value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} placeholder="hello@yourdomain.com" />
              </Field>
              <Field label="From name">
                <Input value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder="ROYALWEB" />
              </Field>
              <Field label="Reply-to">
                <Input value={form.replyTo} onChange={(e) => setForm({ ...form, replyTo: e.target.value })} placeholder="you@yourdomain.com" />
              </Field>
              <Field label="Postal address" hint="Required in the footer for commercial email">
                <Input value={form.postalAddress} onChange={(e) => setForm({ ...form, postalAddress: e.target.value })} placeholder="Street, City, State, PIN" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Unsubscribe URL" hint="Your hosted opt-out page; added to every footer and as a List-Unsubscribe header">
                  <Input value={form.unsubscribeUrl} onChange={(e) => setForm({ ...form, unsubscribeUrl: e.target.value })} placeholder="https://yourdomain.com/unsubscribe" />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-5 py-3">
              <Button variant="gold" onClick={() => void saveConfig()} loading={saving}>
                Save & test login
              </Button>
              <Button variant="secondary" onClick={() => void verify()} loading={verifying} disabled={!config.configured}>
                Verify again
              </Button>
              {config.missing.length && !form.fromAddress ? (
                <span className="text-[10.5px] text-warn">Missing: {config.missing.join(', ')}</span>
              ) : null}
            </div>
            {verifyResult ? (
              <div className="px-5 pb-4">
                <Notice tone={verifyResult.ok ? 'green' : 'red'}>{verifyResult.message}</Notice>
              </div>
            ) : null}
          </Card>

          <div className="space-y-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink-200">
                <ShieldCheck size={14} className="text-gold-400" /> Deliverability
              </div>
              <ul className="mt-2 space-y-2">
                {data.advice.map((item) => (
                  <li key={item.text} className="flex gap-2 text-[11px] leading-relaxed">
                    {item.level === 'ok' ? (
                      <BadgeCheck size={13} className="mt-0.5 shrink-0 text-ok" />
                    ) : (
                      <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
                    )}
                    <span className={item.level === 'ok' ? 'text-ink-400' : 'text-warn/90'}>{item.text}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-white/[0.06] pt-2.5 text-[10.5px] leading-relaxed text-ink-500">
                Also required at your domain: SPF, DKIM and DMARC. The app cannot set DNS records for you — see
                docs/EMAIL.md for the exact records.
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">Sending rules enforced in code</div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-400">
                {OUTREACH_ETHICS.slice(0, 4).map((rule) => (
                  <li key={rule}>• {rule}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'compose' ? (
        <div className="mt-3 grid gap-4 xl:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader
              title="Compose"
              subtitle={activeTemplate?.purpose ?? 'Write from scratch.'}
              icon={<Mail size={16} />}
              action={
                <Button size="sm" variant="secondary" onClick={() => void draft()} loading={drafting} icon={<Sparkles size={12} />}>
                  Draft
                </Button>
              }
            />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap gap-1.5">
                {data.templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTemplate(t.id)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors',
                      template === t.id
                        ? 'border-gold-500/40 bg-gold-500/10 text-gold-200'
                        : 'border-white/[0.08] text-ink-400 hover:text-ink-200'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Recipient name">
                  <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Ravi" />
                </Field>
                <Field label="Their business">
                  <Input value={recipientBusiness} onChange={(e) => setRecipientBusiness(e.target.value)} placeholder="Ravi's Kitchen" />
                </Field>
                <Field label="Email address">
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="ravi@example.com" />
                </Field>
              </div>

              <Field label="Anything specific to include" hint="A real observation beats a compliment. The draft will not invent facts.">
                <Textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={2}
                  placeholder="They mentioned their site is slow on mobile and they want more table bookings."
                />
              </Field>

              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Draft or write a subject" />
              </Field>

              <Field label="Body" hint="Plain text. Footer, address and opt-out are included by the template.">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="font-mono text-[12px] leading-relaxed"
                  placeholder="Press Draft to generate a professional first message."
                />
              </Field>

              {draftNotices.length ? (
                <div className="space-y-1.5">
                  {draftNotices.map((notice) => (
                    <div key={notice} className="text-[10.5px] leading-relaxed text-ink-500">
                      · {notice}
                    </div>
                  ))}
                </div>
              ) : null}

              {sendResult ? (
                <Notice tone={sendResult.ok ? 'green' : 'red'}>{sendResult.message}</Notice>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-5 py-3">
              <Button
                variant="gold"
                icon={<Send size={14} />}
                disabled={!config.configured || !to || !subject || body.trim().length < 20}
                onClick={() => setConfirming(true)}
              >
                Send email
              </Button>
              <span className="text-[10.5px] text-ink-500">
                {config.configured ? `From ${config.fromAddress}` : 'Configure SMTP in Sending setup first'}
              </span>
            </div>
          </Card>

          <div className="space-y-3">
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">Before you send</div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-400">
                <li>• One ask. No attachments on a first email.</li>
                <li>• No fake “re:” subject or false urgency.</li>
                <li>• One follow-up maximum unless they reply.</li>
                <li>• Honour “stop” immediately — the suppress button is in History.</li>
              </ul>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500">Writing standard</div>
              <ul className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-ink-500">
                {QUALITY_RULES.slice(0, 5).map((rule) => (
                  <li key={rule}>• {rule}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === 'history' ? (
        <Card className="mt-3">
          <CardHeader
            title="Sent & attempted"
            subtitle="Status is what the SMTP server accepted — never an assumption"
            icon={<MailCheck size={16} />}
          />
          {data.messages.length === 0 ? (
            <div className="px-5 py-6 text-[12px] text-ink-400">No emails yet.</div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {data.messages.map((message) => (
                <div key={message.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={message.status === 'sent' ? 'green' : message.status === 'suppressed' ? 'purple' : 'red'}
                      dot
                    >
                      {message.status}
                    </Badge>
                    <span className="text-[12px] font-medium text-ink-100">{message.subject}</span>
                    <span className="text-[10.5px] text-ink-500">{message.to_address}</span>
                    <span className="ml-auto text-[10px] text-ink-500">{relativeTime(message.sent_at ?? message.created_at)}</span>
                  </div>
                  {message.error ? <p className="mt-1 text-[10.5px] leading-relaxed text-danger/80">{message.error}</p> : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(message.body);
                        push('Body copied', 'success');
                      }}
                      icon={<ClipboardCopy size={11} />}
                    >
                      Copy body
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void suppress(message.to_address)}>
                      Suppress this address
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send this email?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="gold" loading={sending} onClick={() => void send()} icon={<Send size={13} />}>
              Send from {config.fromAddress || 'configured address'}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-[12.5px] leading-relaxed text-ink-300">
          <p>
            To <span className="text-ink-100">{to || 'no recipient'}</span> · subject{' '}
            <span className="text-ink-100">{subject || 'empty'}</span>
          </p>
          <p className="text-[11px] text-ink-500">
            The message is sent from your own SMTP account and logged. If the server rejects it, the exact reason is stored
            and shown — nothing is marked sent on a guess.
          </p>
        </div>
      </Modal>
    </div>
  );
}
