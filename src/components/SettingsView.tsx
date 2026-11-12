'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Building2, CheckCircle2, DatabaseBackup, Eye, EyeOff, KeyRound, PlugZap, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { OnboardingBackup } from '@/components/OnboardingBackup';
import {
  api,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Spinner,
  Switch,
  Textarea,
  cn,
  useToast,
} from '@/components/ui';

interface Settings {
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
}

interface Payload {
  settings: Settings;
  providers: { id: string; label: string; requiresKey: boolean; note: string }[];
  secrets: { key: string; configured: boolean; source: string }[];
  environment: {
    publicBaseUrl: string | null;
    aiKeyFromEnv: boolean;
    videoRenderer: string;
    encryptionSource: string;
    workerSecret: boolean;
    timezone: string;
  };
}

const OAUTH_KEYS: { provider: string; label: string; idKey: string; secretKey: string }[] = [
  { provider: 'google', label: 'Google (Blogger, YouTube, Business Profile)', idKey: 'oauth.google.clientId', secretKey: 'oauth.google.clientSecret' },
  { provider: 'pinterest', label: 'Pinterest', idKey: 'oauth.pinterest.clientId', secretKey: 'oauth.pinterest.clientSecret' },
  { provider: 'linkedin', label: 'LinkedIn', idKey: 'oauth.linkedin.clientId', secretKey: 'oauth.linkedin.clientSecret' },
  { provider: 'x', label: 'X (Twitter)', idKey: 'oauth.x.clientId', secretKey: 'oauth.x.clientSecret' },
  { provider: 'slack', label: 'Slack', idKey: 'oauth.slack.clientId', secretKey: 'oauth.slack.clientSecret' },
  { provider: 'tumblr', label: 'Tumblr', idKey: 'oauth.tumblr.clientId', secretKey: 'oauth.tumblr.clientSecret' },
];

export function SettingsView() {
  const { push } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiKey, setAiKey] = useState('');
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [tab, setTab] = useState<'business' | 'publishing' | 'ai' | 'integrations' | 'backup'>('business');
  const [showKey, setShowKey] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api<Payload>('/api/settings');
      setData(payload);
      setDraft(payload.settings);
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: {
          businessName: draft.businessName,
          tagline: draft.tagline,
          businessDescription: draft.businessDescription,
          services: draft.services,
          targetCustomers: draft.targetCustomers,
          priceMin: draft.priceMin,
          priceMax: draft.priceMax,
          ctaPrimary: draft.ctaPrimary,
          ctaSecondary: draft.ctaSecondary,
          websiteUrl: draft.websiteUrl,
          whatsappUrl: draft.whatsappUrl,
          contactEmail: draft.contactEmail,
          contactPhone: draft.contactPhone,
          publicContactVisible: draft.publicContactVisible,
          defaultTimezone: draft.defaultTimezone,
          defaultLanguage: draft.defaultLanguage,
          aiProvider: draft.aiProvider,
          aiModel: draft.aiModel,
          postingFrequencyHours: Number(draft.postingFrequencyHours),
          duplicateWindowHours: Number(draft.duplicateWindowHours),
          globalPause: draft.globalPause,
          autoPublishEnabled: draft.autoPublishEnabled,
        },
      });
      push('Settings saved', 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveSecret(key: string, value: string) {
    if (!value) {
      push('Enter a value first.', 'error');
      return;
    }
    try {
      await api('/api/settings', { method: 'POST', body: { key, value } });
      push('Secret stored encrypted', 'success');
      setAiKey('');
      setSecretDraft((prev) => ({ ...prev, [key]: '' }));
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }

  async function testAi() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<{ ok: boolean; provider?: string; model?: string; latencyMs?: number; reply?: string; message?: string; mode?: string }>(
        '/api/settings/test-ai',
        { method: 'POST', body: {} }
      );
      if (result.mode === 'template') {
        setTestResult({ ok: false, message: result.message ?? 'Template engine active.' });
      } else if (result.ok) {
        setTestResult({
          ok: true,
          message: `${result.provider} · ${result.model} responded in ${result.latencyMs}ms — “${result.reply}”`,
        });
        push('AI provider is working', 'success');
      } else {
        setTestResult({ ok: false, message: result.message ?? 'Provider test failed.' });
      }
      await load();
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  if (!data || !draft) return <div className="py-12"><Spinner label="Loading settings…" /></div>;

  const env = data.environment;
  const configured = (key: string) => data.secrets.find((s) => s.key === key);

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Business information lives in the database and is editable here — nothing about your business is hardcoded."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDraft(data.settings)}>Reset</Button>
            <Button variant="gold" loading={saving} onClick={save} icon={<Save size={14} />}>Save changes</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ['business', 'Business', Building2],
            ['publishing', 'Publishing', ShieldCheck],
            ['ai', 'AI provider', Bot],
            ['integrations', 'Integrations', PlugZap],
            ['backup', 'Backup & onboarding', DatabaseBackup],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] transition-colors',
              tab === key
                ? 'border-gold-500/40 bg-gold-500/10 text-gold-200'
                : 'border-white/[0.08] text-ink-400 hover:bg-white/[0.04]'
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {tab === 'business' ? (
            <>
              <Card>
                <CardHeader title="Business identity" subtitle="Used across every generated caption, title and article." icon={<Building2 size={16} />} />
                <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
                  <Field label="Business name">
                    <Input value={draft.businessName} onChange={(e) => setDraft({ ...draft, businessName: e.target.value })} />
                  </Field>
                  <Field label="Tagline">
                    <Input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Business description">
                      <Textarea value={draft.businessDescription} onChange={(e) => setDraft({ ...draft, businessDescription: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Price from (₹)">
                    <Input value={draft.priceMin} onChange={(e) => setDraft({ ...draft, priceMin: e.target.value })} />
                  </Field>
                  <Field label="Price to (₹)">
                    <Input value={draft.priceMax} onChange={(e) => setDraft({ ...draft, priceMax: e.target.value })} />
                  </Field>
                  <Field label="Primary CTA">
                    <Input value={draft.ctaPrimary} onChange={(e) => setDraft({ ...draft, ctaPrimary: e.target.value })} />
                  </Field>
                  <Field label="Secondary CTA">
                    <Input value={draft.ctaSecondary} onChange={(e) => setDraft({ ...draft, ctaSecondary: e.target.value })} />
                  </Field>
                  <Field label="Website URL">
                    <Input type="url" value={draft.websiteUrl} onChange={(e) => setDraft({ ...draft, websiteUrl: e.target.value })} placeholder="https://royalweb.in" />
                  </Field>
                  <Field label="WhatsApp URL">
                    <Input type="url" value={draft.whatsappUrl} onChange={(e) => setDraft({ ...draft, whatsappUrl: e.target.value })} placeholder="https://wa.me/91XXXXXXXXXX" />
                  </Field>
                </div>
              </Card>

              <Card>
                <CardHeader title="Services" subtitle="One per line. Used for content generation and campaign defaults." />
                <div className="px-5 py-4">
                  <Textarea
                    className="min-h-[150px] font-mono text-[12px]"
                    value={draft.services.join('\n')}
                    onChange={(e) => setDraft({ ...draft, services: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Target customers" subtitle="One per line. Drives audience targeting in captions." />
                <div className="px-5 py-4">
                  <Textarea
                    className="min-h-[150px] font-mono text-[12px]"
                    value={draft.targetCustomers.join('\n')}
                    onChange={(e) => setDraft({ ...draft, targetCustomers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Public contact & privacy" subtitle="Your personal email and phone stay private unless you explicitly publish them." icon={<ShieldCheck size={16} />} />
                <div className="space-y-4 px-5 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Contact email (private by default)">
                      <Input value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} placeholder="hello@yourdomain.in" />
                    </Field>
                    <Field label="Contact phone (private by default)">
                      <Input value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} placeholder="+91 …" />
                    </Field>
                  </div>
                  <Switch
                    checked={draft.publicContactVisible}
                    onChange={(next) => setDraft({ ...draft, publicContactVisible: next })}
                    label="Publish contact details in generated content"
                    description="When off, WhatsApp/phone/email are stripped from every caption and manual package. Your website URL is still used."
                  />
                  {draft.publicContactVisible ? (
                    <Notice tone="amber" title="Public contact is ON">
                      The email and phone above may appear in published posts and downloadable packages. Only enable this
                      if you are comfortable with them being public.
                    </Notice>
                  ) : (
                    <Notice tone="green" title="Private by default">
                      Contact details are kept out of generated content. Campaigns can still reference your website and
                      WhatsApp link if you enter them on the campaign itself.
                    </Notice>
                  )}
                </div>
              </Card>
            </>
          ) : null}

          {tab === 'publishing' ? (
            <>
              <Card>
                <CardHeader title="Publishing controls" subtitle="Global safety switches for the background worker." />
                <div className="space-y-5 px-5 py-4">
                  <Switch
                    checked={draft.globalPause}
                    onChange={(next) => setDraft({ ...draft, globalPause: next })}
                    label="Pause all scheduled publishing"
                    description="Stops the worker from sending any job to any platform. Queued jobs remain scheduled and resume when you switch this off."
                  />
                  <Switch
                    checked={draft.autoPublishEnabled}
                    onChange={(next) => setDraft({ ...draft, autoPublishEnabled: next })}
                    label="Allow automatic publishing"
                    description="When off, jobs stay queued even if the platform is connected. Useful while reviewing content."
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Default timezone">
                      <Select value={draft.defaultTimezone} onChange={(e) => setDraft({ ...draft, defaultTimezone: e.target.value })}>
                        {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map((zone) => (
                          <option key={zone} value={zone}>{zone}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Default language">
                      <Select value={draft.defaultLanguage} onChange={(e) => setDraft({ ...draft, defaultLanguage: e.target.value })}>
                        {['English', 'Hindi', 'Assamese', 'Bengali', 'Marathi', 'Tamil', 'Telugu', 'Gujarati'].map((lang) => (
                          <option key={lang} value={lang}>{lang}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Minimum gap between posts (hours)" hint="Used as the default posting frequency for recurring campaigns.">
                      <Input
                        type="number"
                        min={1}
                        value={draft.postingFrequencyHours}
                        onChange={(e) => setDraft({ ...draft, postingFrequencyHours: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Duplicate-content window (hours)" hint="Identical copy is blocked on the same platform inside this window.">
                      <Input
                        type="number"
                        min={0}
                        value={draft.duplicateWindowHours}
                        onChange={(e) => setDraft({ ...draft, duplicateWindowHours: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                  <Notice tone="neutral" title="How the worker behaves">
                    The publishing worker runs every 20 seconds inside the app server (or you can run `npm run worker`
                    against `/api/worker/tick`). Temporary failures retry with exponential backoff (2 → 8 → 32 min);
                    permission errors are never retried endlessly; expired credentials mark the account and surface
                    “CONNECTION EXPIRED”.
                  </Notice>
                </div>
              </Card>
            </>
          ) : null}

          {tab === 'ai' ? (
            <>
              <Card>
                <CardHeader title="AI provider" subtitle="Bring your own provider — nothing is hardcoded to one vendor." icon={<Bot size={16} />} />
                <div className="space-y-4 px-5 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Provider">
                      <Select value={draft.aiProvider} onChange={(e) => setDraft({ ...draft, aiProvider: e.target.value })}>
                        <option value="auto">Auto (OpenAI when a key exists)</option>
                        {data.providers.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Model" hint="Leave blank to use the provider default.">
                      <Input value={draft.aiModel} onChange={(e) => setDraft({ ...draft, aiModel: e.target.value })} placeholder="gpt-4o-mini / claude-3-5-sonnet-latest / gemini-2.0-flash" />
                    </Field>
                  </div>

                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[12px] font-medium text-ink-200">API key</div>
                        <div className="text-[11px] text-ink-500">
                          {configured('ai.apiKey')?.configured
                            ? `Configured via ${configured('ai.apiKey')?.source}. Enter a new value to replace it.`
                            : 'Not configured — the built-in template engine will be used.'}
                        </div>
                      </div>
                      <Badge tone={configured('ai.apiKey')?.configured ? 'green' : 'amber'}>
                        {configured('ai.apiKey')?.configured ? 'ready' : 'template mode'}
                      </Badge>
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showKey ? 'text' : 'password'}
                          value={aiKey}
                          onChange={(e) => setAiKey(e.target.value)}
                          placeholder="sk-…"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-200"
                          aria-label="Toggle visibility"
                        >
                          {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <Button variant="secondary" onClick={() => saveSecret('ai.apiKey', aiKey)} icon={<KeyRound size={13} />}>
                        Save key
                      </Button>
                      <Button variant="gold" loading={testing} onClick={testAi} icon={<Sparkles size={13} />}>
                        Test
                      </Button>
                    </div>
                    {testResult ? (
                      <div className="mt-2">
                        <Notice tone={testResult.ok ? 'green' : 'red'}>{testResult.message}</Notice>
                      </div>
                    ) : null}
                  </div>

                  <Field label="Custom base URL (optional)" hint="For OpenAI-compatible gateways (LiteLLM, vLLM, Azure proxy) or a self-hosted Ollama endpoint.">
                    <div className="flex gap-2">
                      <Input
                        value={secretDraft['ai.baseUrl'] ?? ''}
                        onChange={(e) => setSecretDraft({ ...secretDraft, 'ai.baseUrl': e.target.value })}
                        placeholder="https://my-gateway.example.com/v1"
                      />
                      <Button variant="secondary" onClick={() => saveSecret('ai.baseUrl', secretDraft['ai.baseUrl'] ?? '')}>
                        Save
                      </Button>
                    </div>
                  </Field>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.providers.map((p) => (
                      <div key={p.id} className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11.5px] text-ink-200">{p.label}</span>
                          {p.requiresKey ? <Badge tone="neutral">key</Badge> : <Badge tone="green">no key</Badge>}
                        </div>
                        <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-500">{p.note}</p>
                      </div>
                    ))}
                  </div>

                  <Notice tone="amber" title="Honest fallback">
                    If no provider is configured — or the provider errors — ROYALWEB generates content with the built-in
                    template engine and labels it “Template” in the campaign view. Poster text is only read when a
                    vision-capable model is available.
                  </Notice>
                </div>
              </Card>
            </>
          ) : null}

          {tab === 'integrations' ? (
            <>
              <Card>
                <CardHeader title="OAuth applications" subtitle="Client IDs and secrets for platforms whose publishing requires OAuth. Stored encrypted server-side." icon={<PlugZap size={16} />} />
                <div className="divide-y divide-white/[0.05]">
                  {OAUTH_KEYS.map((entry) => (
                    <div key={entry.provider} className="px-5 py-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[12.5px] font-medium text-ink-200">{entry.label}</div>
                        <div className="flex gap-1">
                          <Badge tone={configured(entry.idKey)?.configured ? 'green' : 'neutral'}>
                            client id {configured(entry.idKey)?.configured ? 'set' : 'missing'}
                          </Badge>
                          <Badge tone={configured(entry.secretKey)?.configured ? 'green' : 'neutral'}>
                            secret {configured(entry.secretKey)?.configured ? 'set' : 'missing'}
                          </Badge>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="flex gap-2">
                          <Input
                            placeholder="Client ID"
                            value={secretDraft[entry.idKey] ?? ''}
                            onChange={(e) => setSecretDraft({ ...secretDraft, [entry.idKey]: e.target.value })}
                          />
                          <Button size="sm" variant="secondary" onClick={() => saveSecret(entry.idKey, secretDraft[entry.idKey] ?? '')}>Save</Button>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            type="password"
                            placeholder="Client secret"
                            value={secretDraft[entry.secretKey] ?? ''}
                            onChange={(e) => setSecretDraft({ ...secretDraft, [entry.secretKey]: e.target.value })}
                          />
                          <Button size="sm" variant="secondary" onClick={() => saveSecret(entry.secretKey, secretDraft[entry.secretKey] ?? '')}>Save</Button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[10.5px] text-ink-500">
                        Redirect URI to register: <code className="rounded bg-white/[0.05] px-1 py-0.5 text-gold-300">{env.publicBaseUrl ?? 'https://your-domain'}/api/oauth/{entry.provider}/callback</code>
                      </p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Environment" subtitle="Server-side configuration detected at runtime." icon={<CheckCircle2 size={16} />} />
                <div className="grid gap-2 px-5 py-4 text-[11.5px] sm:grid-cols-2">
                  <EnvRow label="Public base URL" value={env.publicBaseUrl ?? 'not set — required for image URLs and OAuth callbacks'} ok={Boolean(env.publicBaseUrl)} />
                  <EnvRow label="Video renderer (YouTube Shorts)" value={env.videoRenderer} ok={env.videoRenderer.includes('available')} />
                  <EnvRow label="Credential encryption" value={env.encryptionSource} ok />
                  <EnvRow label="Worker secret" value={env.workerSecret ? 'configured' : 'not set (in-process worker only)'} ok={env.workerSecret} />
                  <EnvRow label="AI key from environment" value={env.aiKeyFromEnv ? 'yes' : 'no'} ok={env.aiKeyFromEnv} />
                  <EnvRow label="Default timezone" value={env.timezone} ok />
                </div>
                <div className="px-5 pb-4">
                  <Notice tone="neutral">
                    Secrets are AES-256-GCM encrypted with a server-side key. They are never included in API responses,
                    the frontend bundle or localStorage — only masked status is shown.
                  </Notice>
                </div>
              </Card>
            </>
          ) : null}
          {tab === 'backup' ? <OnboardingBackup /> : null}
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500">Quick status</div>
            <div className="mt-2.5 space-y-2 text-[11.5px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-400">Publishing</span>
                <Badge tone={draft.globalPause ? 'amber' : 'green'} dot>{draft.globalPause ? 'paused' : 'active'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-400">Public contact</span>
                <Badge tone={draft.publicContactVisible ? 'amber' : 'green'} dot>{draft.publicContactVisible ? 'visible' : 'private'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-400">AI provider</span>
                <Badge tone={configured('ai.apiKey')?.configured ? 'green' : 'neutral'}>
                  {configured('ai.apiKey')?.configured ? draft.aiProvider : 'template engine'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-400">Duplicate window</span>
                <span className="text-ink-200">{draft.duplicateWindowHours}h</span>
              </div>
            </div>
          </Card>

          <Button variant="gold" className="w-full" loading={saving} onClick={save} icon={<Save size={14} />}>
            Save all settings
          </Button>

          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500">Do not put secrets here</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
              Never paste API keys into campaign fields, captions or descriptions. Use the AI and Integration tabs,
              where values are encrypted and never returned to the browser.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function EnvRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5">
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-ok' : 'bg-warn')} />
        <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      </div>
      <div className="mt-0.5 break-words text-[11px] text-ink-300">{value}</div>
    </div>
  );
}
