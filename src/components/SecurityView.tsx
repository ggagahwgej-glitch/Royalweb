'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut, Monitor, ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
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
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui';
import { formatInZone, relativeTime } from '@/lib/time';

interface Session {
  id: string;
  ip: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  current: number;
}

interface SecurityData {
  sessions: Session[];
  auditLogs: { id: string; action: string; entity: string; entity_id: string; ip: string; created_at: string; meta_json: string }[];
  publishingLogs: { id: string; level: string; step: string; message: string; created_at: string; platform_name: string | null }[];
  accounts: { id: string; account_name: string; status: string; token_expires_at: string | null; last_verified_at: string | null; last_error: string | null; platform_name: string }[];
  failedLogins24h: number;
  posture: {
    encryption: string;
    sessionTtlHours: number;
    cookieHttpOnly: boolean;
    cookieSameSite: string;
    cookieSecure: boolean;
    globalPause: boolean;
    publicContactVisible: boolean;
    tokensInFrontend: boolean;
    workerSecretConfigured: boolean;
  };
}

export function SecurityView() {
  const { push } = useToast();
  const router = useRouter();
  const [data, setData] = useState<SecurityData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [tab, setTab] = useState<'overview' | 'audit' | 'publishing'>('overview');

  const load = useCallback(async () => {
    try {
      setData(await api<SecurityData>('/api/security'));
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key);
    try {
      await fn();
      push(message, 'success');
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function changePassword() {
    if (next.length < 10) {
      push('New password must be at least 10 characters.', 'error');
      return;
    }
    setBusy('password');
    try {
      await api('/api/security', { method: 'POST', body: { action: 'change-password', currentPassword: current, newPassword: next } });
      push('Password changed — sign in again.', 'success');
      setCurrent('');
      setNext('');
      setTimeout(() => {
        router.replace('/login');
        router.refresh();
      }, 1200);
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="py-12"><Spinner label="Loading security overview…" /></div>;

  return (
    <div>
      <PageHeader
        eyebrow="Hardening"
        title="Security"
        description="Sessions, encrypted credentials, audit trail and publishing health. This page never displays secret values."
        actions={<Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void load()}>Refresh</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Encryption</div>
          <div className="mt-1 text-[12.5px] text-ink-100">AES-256-GCM</div>
          <div className="text-[10px] text-ink-500">{data.posture.encryption}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Active sessions</div>
          <div className="mt-1 text-[18px] font-semibold text-ink-100">{data.sessions.length}</div>
          <div className="text-[10px] text-ink-500">{data.posture.sessionTtlHours}h TTL</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Failed logins (24h)</div>
          <div className={`mt-1 text-[18px] font-semibold ${data.failedLogins24h ? 'text-warn' : 'text-ink-100'}`}>{data.failedLogins24h}</div>
          <div className="text-[10px] text-ink-500">rate-limited</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Token exposure</div>
          <div className="mt-1 text-[12.5px] text-ok">None in browser</div>
          <div className="text-[10px] text-ink-500">server-side only</div>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ['overview', 'Sessions & accounts'],
            ['audit', 'Audit log'],
            ['publishing', 'Publishing log'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg border px-3 py-1.5 text-[11.5px] ${
              tab === key ? 'border-gold-500/40 bg-gold-500/10 text-gold-200' : 'border-white/[0.08] text-ink-400 hover:bg-white/[0.04]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {tab === 'overview' ? (
            <>
              <Card>
                <CardHeader
                  title="Sessions"
                  subtitle="HTTP-only cookie sessions, hashed server-side and revocable immediately."
                  icon={<Monitor size={16} />}
                  action={
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" loading={busy === 'revoke-others'} onClick={() => action('revoke-others', () => api('/api/security', { method: 'POST', body: { action: 'revoke-others' } }), 'Other sessions revoked')}>
                        Revoke others
                      </Button>
                      <Button size="sm" variant="danger" loading={busy === 'revoke-all'} onClick={() => action('revoke-all', () => api('/api/security', { method: 'POST', body: { action: 'revoke-all' } }), 'All sessions revoked')} icon={<LogOut size={12} />}>
                        Sign out all
                      </Button>
                    </div>
                  }
                />
                <div className="divide-y divide-white/[0.05]">
                  {data.sessions.map((session) => (
                    <div key={session.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <Monitor size={15} className="text-ink-500" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12px] text-ink-200">{session.user_agent.slice(0, 60)}</span>
                          {session.current ? <Badge tone="green">this session</Badge> : null}
                        </div>
                        <div className="text-[10.5px] text-ink-500">
                          {session.ip} · started {relativeTime(session.created_at)} · expires {formatInZone(session.expires_at, 'Asia/Kolkata')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <CardHeader title="Credential health" subtitle="Live connection status of every platform account." icon={<ShieldCheck size={16} />} />
                {data.accounts.length === 0 ? (
                  <div className="px-5 py-5 text-[12px] text-ink-400">No accounts connected.</div>
                ) : (
                  <div className="divide-y divide-white/[0.05]">
                    {data.accounts.map((account) => (
                      <div key={account.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${account.status === 'connected' ? 'bg-ok' : 'bg-danger'}`} />
                        <span className="text-[12px] text-ink-200">{account.platform_name}</span>
                        <span className="truncate text-[11px] text-ink-500">{account.account_name}</span>
                        <div className="ml-auto flex items-center gap-2">
                          {account.token_expires_at ? (
                            <span className="text-[10px] text-ink-500">expires {relativeTime(account.token_expires_at)}</span>
                          ) : null}
                          <StatusBadge status={account.status} />
                        </div>
                        {account.last_error ? <div className="w-full text-[10.5px] text-danger/80">{account.last_error}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          ) : null}

          {tab === 'audit' ? (
            <Card>
              <CardHeader title="Audit log" subtitle="Every administrative action is recorded with its source IP." icon={<ShieldCheck size={16} />} />
              <div className="max-h-[560px] divide-y divide-white/[0.04] overflow-y-auto">
                {data.auditLogs.map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-baseline gap-2 px-5 py-2">
                    <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-gold-300/90">{entry.action}</span>
                    <span className="text-[11px] text-ink-300">{entry.entity}</span>
                    <span className="truncate font-mono text-[10px] text-ink-600">{entry.entity_id}</span>
                    <span className="ml-auto text-[10px] text-ink-500">{entry.ip}</span>
                    <span className="text-[10px] text-ink-500">{formatInZone(entry.created_at, 'Asia/Kolkata')}</span>
                  </div>
                ))}
                {data.auditLogs.length === 0 ? <div className="px-5 py-5 text-[12px] text-ink-500">No audit entries yet.</div> : null}
              </div>
            </Card>
          ) : null}

          {tab === 'publishing' ? (
            <Card>
              <CardHeader title="Publishing log" subtitle="What each adapter actually did, including failures." />
              <div className="max-h-[560px] overflow-y-auto px-5 py-3 font-mono text-[10.5px] leading-relaxed">
                {data.publishingLogs.map((entry) => (
                  <div key={entry.id} className="flex gap-2 border-b border-white/[0.03] py-1 last:border-0">
                    <span className="shrink-0 text-ink-600">{new Date(entry.created_at).toLocaleTimeString()}</span>
                    <span className={`shrink-0 uppercase ${entry.level === 'error' ? 'text-danger' : entry.level === 'warn' ? 'text-warn' : 'text-ink-500'}`}>
                      {entry.step}
                    </span>
                    <span className="text-ink-300">
                      {entry.platform_name ? `[${entry.platform_name}] ` : ''}
                      {entry.message}
                    </span>
                  </div>
                ))}
                {data.publishingLogs.length === 0 ? <div className="text-ink-500">No publishing activity yet.</div> : null}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink-200">
              <KeyRound size={14} className="text-gold-400" /> Change password
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Current password">
                <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
              </Field>
              <Field label="New password" hint="Minimum 10 characters. All sessions are signed out.">
                <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              </Field>
              <Button variant="secondary" className="w-full" loading={busy === 'password'} onClick={changePassword}>
                Update password
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink-200">
              <ShieldAlert size={14} className="text-gold-400" /> Posture
            </div>
            <dl className="mt-2.5 space-y-1.5 text-[11px]">
              <Row label="Cookie" value={`HttpOnly · SameSite=${data.posture.cookieSameSite}${data.posture.cookieSecure ? ' · Secure' : ''}`} />
              <Row label="Session TTL" value={`${data.posture.sessionTtlHours} hours`} />
              <Row label="CSRF" value="Origin + custom header" />
              <Row label="Rate limits" value="login, uploads, generation" />
              <Row label="Global pause" value={data.posture.globalPause ? 'active' : 'off'} />
              <Row label="Public contact" value={data.posture.publicContactVisible ? 'visible' : 'private'} />
              <Row label="Worker secret" value={data.posture.workerSecretConfigured ? 'configured' : 'not set'} />
            </dl>
            <div className="mt-3">
              <Notice tone="neutral">
                Credentials are encrypted with a key held outside the database. Rotating the key requires reconnecting
                accounts; keep <code className="text-gold-300">ROYALWEB_ENCRYPTION_KEY</code> stable and secret.
              </Notice>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/[0.04] pb-1">
      <dt className="text-ink-500">{label}</dt>
      <dd className="max-w-[60%] text-right text-ink-300">{value}</dd>
    </div>
  );
}
