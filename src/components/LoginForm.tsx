'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { api, Button, Field, Input, Notice } from '@/components/ui';

export function LoginForm({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'setup'>(needsSetup ? 'setup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('ROYALWEB Admin');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'setup') {
        await api('/api/auth/setup', { method: 'POST', body: { email, password, name } });
      } else {
        await api('/api/auth/login', { method: 'POST', body: { email, password } });
      }
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.2em] text-gold-500">
        {mode === 'setup' ? 'First run' : 'Admin access'}
      </div>
      <h2 className="text-[26px] font-semibold tracking-tight text-ink-100">
        {mode === 'setup' ? 'Create your administrator' : 'Welcome back'}
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">
        {mode === 'setup'
          ? 'This account controls publishing across all 25 platforms. Use a strong, unique password.'
          : 'Sign in to the ROYALWEB AUTOPILOT control room.'}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode === 'setup' ? (
          <Field label="Name">
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
              <Input
                className="pl-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Your name"
              />
            </div>
          </Field>
        ) : null}

        <Field label="Email">
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <Input
              className="pl-9"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="admin@royalweb.in"
            />
          </div>
        </Field>

        <Field
          label="Password"
          hint={mode === 'setup' ? 'Minimum 10 characters. Stored as a salted scrypt hash.' : undefined}
        >
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <Input
              className="pl-9 pr-10"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={mode === 'setup' ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              placeholder="••••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-500 hover:text-ink-200"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>

        {error ? <Notice tone="red">{error}</Notice> : null}

        <Button type="submit" variant="gold" size="lg" loading={busy} className="w-full" icon={<ArrowRight size={16} />}>
          {mode === 'setup' ? 'Create account & enter' : 'Sign in'}
        </Button>
      </form>

      {mode === 'setup' ? (
        <p className="mt-5 text-[11.5px] leading-relaxed text-ink-500">
          Setup is only available while no administrator exists. If you already created one, this form is disabled.
        </p>
      ) : (
        <p className="mt-5 text-[11.5px] leading-relaxed text-ink-500">
          Eight failed attempts lock the account for 15 minutes. Login attempts are rate-limited and logged.
        </p>
      )}
    </div>
  );
}
