'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Link2, RefreshCw, ShieldCheck, Trash2, Unplug, Settings2 } from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  cn,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';
import { relativeTime, formatInZone } from '@/lib/time';

interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  help?: string;
}

interface Platform {
  id: string;
  name: string;
  group: string;
  automation: string;
  integration: string;
  oauthRequired: boolean;
  oauthConfigured: boolean;
  credentialFields: CredentialField[];
  connectInstructions: string;
  permissionNotes: string;
  notes: string;
  manualUrl: string | null;
}

interface Account {
  id: string;
  platformId: string;
  platformName?: string;
  accountName: string;
  status: string;
  scopes: string;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  externalId: string | null;
  meta: Record<string, unknown>;
}

const OAUTH_PROVIDER: Record<string, string> = {
  blogger: 'google',
  youtube: 'google',
  googlebusiness: 'google',
  pinterest: 'pinterest',
  linkedin: 'linkedin',
  x: 'x',
  slack: 'slack',
  tumblr: 'tumblr',
};

export function AccountsView() {
  const searchParams = useSearchParams();
  const { push } = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [platformId, setPlatformId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<Account | null>(null);
  const [destinationValues, setDestinationValues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        api<{ accounts: Account[] }>('/api/accounts'),
        api<{ platforms: Platform[] }>('/api/platforms'),
      ]);
      setAccounts(a.accounts);
      setPlatforms(p.platforms);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    const message = searchParams.get('message');
    if (oauth && message) {
      push(message, oauth === 'success' ? 'success' : oauth === 'incomplete' ? 'info' : 'error');
    }
  }, [searchParams, push]);

  const platform = useMemo(() => platforms.find((p) => p.id === platformId), [platforms, platformId]);
  const feasible = platforms.filter((p) => p.automation !== 'manual');
  const manual = platforms.filter((p) => p.automation === 'manual');

  function startConnect(id: string) {
    const target = platforms.find((p) => p.id === id);
    setPlatformId(id);
    setValues({});
    setConnectOpen(true);
    if (target && !target.oauthRequired && target.credentialFields.length === 1) {
      // nothing
    }
  }

  async function submit() {
    if (!platform) return;
    setBusy('connect');
    try {
      await api('/api/accounts', {
        method: 'POST',
        body: { platformId: platform.id, accountName: values.accountName || platform.name, credentials: values },
      });
      push(`${platform.name} connected and verified`, 'success');
      setConnectOpen(false);
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function verify(account: Account) {
    setBusy(`verify:${account.id}`);
    try {
      const data = await api<{ ok: boolean; detail: string | null }>(`/api/accounts/${account.id}/verify`, {
        method: 'POST',
        body: {},
      });
      push(data.ok ? `${account.platformName} verified` : data.detail ?? 'Verification failed', data.ok ? 'success' : 'error');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(account: Account) {
    if (!confirm(`Disconnect ${account.accountName}? Pending jobs for this account will be cancelled.`)) return;
    setBusy(`disconnect:${account.id}`);
    try {
      await api(`/api/accounts/${account.id}`, { method: 'DELETE' });
      push(`${account.platformName} disconnected`, 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveDestination() {
    if (!destination) return;
    setBusy('destination');
    try {
      const data = await api<{ verified: boolean; detail?: string }>(`/api/accounts/${destination.id}`, {
        method: 'PATCH',
        body: { destination: destinationValues },
      });
      push(data.verified ? 'Destination updated and verified' : data.detail ?? 'Saved, but verification failed', data.verified ? 'success' : 'error');
      setDestination(null);
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  function openDestination(account: Account) {
    const p = platforms.find((x) => x.id === account.platformId);
    const fields: Record<string, string> = {};
    (p?.credentialFields ?? [])
      .filter((f) => f.type !== 'password' && f.key !== 'accessToken' && f.key !== 'refreshToken')
      .forEach((f) => {
        fields[f.key] = '';
      });
    setDestinationValues(fields);
    setDestination(account);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Credentials"
        title="Connected accounts"
        description="Connect with official OAuth where available, or an app-specific token. Secrets are encrypted with AES-256-GCM on the server and are never sent to the browser."
        actions={
          <Button variant="gold" onClick={() => { setPlatformId(''); setValues({}); setConnectOpen(true); }} icon={<Link2 size={14} />}>
            Connect account
          </Button>
        }
      />

      {error ? <Notice tone="red">{error}</Notice> : null}

      <Card className="mb-4 p-4">
        <div className="flex items-start gap-2.5 text-[11.5px] leading-relaxed text-ink-400">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-gold-400" />
          <p>
            ROYALWEB never asks for your social-media password. Use OAuth or platform-issued app passwords
            (WordPress Application Passwords, Bluesky App Passwords, bot tokens, API keys). Tokens are stored encrypted
            and can be revoked at any time from this page.
          </p>
        </div>
      </Card>

      {!accounts ? (
        <div className="py-12"><Spinner label="Loading accounts…" /></div>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Link2 size={22} />}
            title="No accounts connected"
            description="Start with Telegram or WordPress — both verify instantly and can publish automatically. OAuth platforms need client credentials in Settings → Integrations."
            action={<Button variant="gold" onClick={() => setConnectOpen(true)}>Connect your first account</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {accounts.map((account) => (
            <Card key={account.id} className="p-4">
              <div className="flex items-start gap-3">
                <PlatformMark id={account.platformId} name={account.platformName} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-ink-100">{account.platformName}</span>
                    <StatusBadge status={account.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-ink-400">{account.accountName}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-500">
                    {account.lastVerifiedAt ? <span>verified {relativeTime(account.lastVerifiedAt)}</span> : <span>not verified yet</span>}
                    {account.tokenExpiresAt ? <span>token expires {formatInZone(account.tokenExpiresAt, 'Asia/Kolkata')}</span> : null}
                    {account.scopes ? <span className="truncate">{account.scopes.split(' ').slice(0, 3).join(' · ')}</span> : null}
                  </div>
                  {account.lastError ? (
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-danger/90">{account.lastError}</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" loading={busy === `verify:${account.id}`} onClick={() => verify(account)} icon={<RefreshCw size={11} />}>
                  Verify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openDestination(account)} icon={<Settings2 size={11} />}>
                  Destination
                </Button>
                <Button size="sm" variant="ghost" loading={busy === `disconnect:${account.id}`} onClick={() => disconnect(account)} icon={<Unplug size={11} />} className="text-danger hover:bg-danger/10">
                  Disconnect
                </Button>
                {account.status === 'error' || account.status === 'expired' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const provider = OAUTH_PROVIDER[account.platformId];
                      if (provider) window.location.href = `/api/oauth/${provider}/start?platform=${account.platformId}`;
                      else startConnect(account.platformId);
                    }}
                  >
                    Reconnect
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-[12px] font-medium text-ink-200">API-capable platforms</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {feasible.map((p) => (
              <button
                key={p.id}
                onClick={() => startConnect(p.id)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2 py-1 text-[10.5px] text-ink-300 hover:border-gold-500/30 hover:text-ink-100"
              >
                <PlatformMark id={p.id} size="sm" className="h-5 w-5 text-[8px]" />
                {p.name}
                {p.oauthRequired ? <Badge tone={p.oauthConfigured ? 'green' : 'purple'}>{p.oauthConfigured ? 'oauth' : 'needs app'}</Badge> : null}
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[12px] font-medium text-ink-200">Manual platforms</div>
          <p className="mt-1 text-[11px] text-ink-500">
            No account needed — ROYALWEB prepares packages. Add your profile URL for reference.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {manual.map((p) => (
              <button
                key={p.id}
                onClick={() => startConnect(p.id)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2 py-1 text-[10.5px] text-ink-300 hover:border-[#a78bd8]/30 hover:text-ink-100"
              >
                <PlatformMark id={p.id} size="sm" className="h-5 w-5 text-[8px]" />
                {p.name}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Connect modal */}
      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title={platform ? `Connect ${platform.name}` : 'Connect an account'}
        wide
        footer={
          platform ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-ink-500">Credentials are verified before being saved.</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setConnectOpen(false)}>Cancel</Button>
                <Button variant="gold" loading={busy === 'connect'} onClick={submit} icon={<CheckCircle2 size={14} />}>
                  Verify & connect
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        <div className="space-y-4">
          <Field label="Platform">
            <Select
              value={platformId}
              onChange={(e) => {
                setPlatformId(e.target.value);
                setValues({});
              }}
            >
              <option value="">Choose a platform…</option>
              <optgroup label="API-capable">
                {feasible.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Manual">
                {manual.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            </Select>
          </Field>

          {platform ? (
            <>
              <Notice tone="neutral" title="How to get access">
                {platform.connectInstructions}
              </Notice>

              {platform.oauthRequired ? (
                <div className={cn('rounded-xl border p-3', platform.oauthConfigured ? 'border-ok/25 bg-ok/[0.05]' : 'border-warn/25 bg-warn/[0.05]')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] text-ink-200">
                      {platform.oauthConfigured
                        ? 'OAuth app is configured — connect securely without pasting tokens.'
                        : 'Add the OAuth client ID and secret in Settings → Integrations first.'}
                    </div>
                    {platform.oauthConfigured ? (
                      <Button
                        size="sm"
                        variant="gold"
                        onClick={() => {
                          const provider = OAUTH_PROVIDER[platform.id];
                          if (provider) window.location.href = `/api/oauth/${provider}/start?platform=${platform.id}`;
                        }}
                        icon={<Link2 size={13} />}
                      >
                        Connect with {platform.id === 'x' ? 'X' : platform.name.split(' ')[0]}
                      </Button>
                    ) : (
                      <a href="/dashboard/settings" className="text-[11px] text-gold-300 hover:text-gold-200">Open settings →</a>
                    )}
                  </div>
                </div>
              ) : null}

              {platform.automation === 'manual' ? (
                <div className="rounded-xl border border-[#a78bd8]/20 bg-[#a78bd8]/[0.05] p-3 text-[11.5px] leading-relaxed text-[#ded1f2]">
                  This platform has no supported publishing API. Saving your profile URL lets ROYALWEB open the right
                  place when you work in the Manual Publishing Center. Nothing is automated.
                </div>
              ) : null}

              {platform.credentialFields.map((field) => (
                <Field key={field.key} label={field.label} required={field.required} hint={field.help}>
                  {field.key === 'pds' || field.key === 'apiBase' ? (
                    <Input
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    />
                  ) : field.type === 'password' ? (
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={field.placeholder ?? '••••••••'}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    />
                  ) : field.type === 'url' ? (
                    <Input
                      type="url"
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    />
                  ) : (
                    <Input
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}

              {platform.automation !== 'manual' ? (
                <Field label="Account label (optional)" hint="Shown in the dashboard so you can tell multiple accounts apart.">
                  <Input
                    placeholder={`${platform.name} — primary`}
                    value={values.accountName ?? ''}
                    onChange={(e) => setValues({ ...values, accountName: e.target.value })}
                  />
                </Field>
              ) : null}

              <div className="text-[11px] leading-relaxed text-ink-500">{platform.permissionNotes}</div>
            </>
          ) : null}
        </div>
      </Modal>

      {/* Destination modal */}
      <Modal
        open={Boolean(destination)}
        onClose={() => setDestination(null)}
        title={`${destination?.platformName ?? ''} destination`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDestination(null)}>Cancel</Button>
            <Button variant="gold" loading={busy === 'destination'} onClick={saveDestination}>Save & verify</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[11.5px] leading-relaxed text-ink-400">
            Choose which board, channel, blog or page to publish to. Leave a field blank to use the platform default.
          </p>
          {Object.keys(destinationValues).length === 0 ? (
            <Notice tone="neutral">This platform has no selectable destination — the token itself determines where posts go.</Notice>
          ) : (
            Object.entries(destinationValues).map(([key, value]) => {
              const field = platforms
                .find((p) => p.id === destination?.platformId)
                ?.credentialFields.find((f) => f.key === key);
              return (
                <Field key={key} label={field?.label ?? key} hint={field?.help}>
                  <Input value={value} placeholder={field?.placeholder} onChange={(e) => setDestinationValues({ ...destinationValues, [key]: e.target.value })} />
                </Field>
              );
            })
          )}
          {destination?.meta?.boards ? (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-[11px] text-ink-400">
              Available: {(destination.meta.boards as { id: string; name: string }[]).map((b) => `${b.name} (${b.id})`).join(', ')}
            </div>
          ) : null}
          {destination?.meta?.blogs ? (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-[11px] text-ink-400">
              Blogs: {(destination.meta.blogs as { id: string; name: string }[]).map((b) => `${b.name} (${b.id})`).join(', ')}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
