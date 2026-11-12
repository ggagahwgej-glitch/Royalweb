'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock3,
  LayoutDashboard,
  LibraryBig,
  Mail,
  LogOut,
  Menu,
  MessageSquareText,
  PauseCircle,
  PenLine,
  PlusCircle,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  X,
} from 'lucide-react';
import { BrandMark } from '@/components/BrandMark';
import { api, Badge, cn } from '@/components/ui';

const SECTIONS = [
  {
    label: 'Operate',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/new', label: 'Create Campaign', icon: PlusCircle },
      { href: '/dashboard/media', label: 'Media Library', icon: LibraryBig },
      { href: '/dashboard/calendar', label: 'Publishing Calendar', icon: CalendarDays },
    ],
  },
  {
    label: 'Platforms',
    items: [
      { href: '/dashboard/platforms', label: 'All Platforms', icon: Send, badge: '25' },
      { href: '/dashboard/accounts', label: 'Connected Accounts', icon: Users },
    ],
  },
  {
    label: 'Publishing',
    items: [
      { href: '/dashboard/scheduled', label: 'Scheduled Posts', icon: Clock3 },
      { href: '/dashboard/published', label: 'Published Posts', icon: Activity },
      { href: '/dashboard/manual', label: 'Manual Queue', icon: PenLine },
      { href: '/dashboard/email', label: 'Email Outreach', icon: Mail },
      { href: '/dashboard/failed', label: 'Failed Posts', icon: CircleAlert },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/dashboard/studio', label: 'AI Content Studio', icon: Sparkles },
      { href: '/dashboard/assistant', label: 'AI Assistant', icon: MessageSquareText },
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/dashboard/diagnostics', label: 'Diagnostics', icon: Stethoscope },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
      { href: '/dashboard/security', label: 'Security', icon: ShieldCheck },
    ],
  },
];

export function Sidebar({
  user,
  businessName,
  paused,
}: {
  user: { name: string; email: string };
  businessName: string;
  paused: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  async function signOut() {
    setSigningOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* cookie cleared regardless */
    }
    router.replace('/login');
    router.refresh();
  }

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/dashboard" onClick={() => setOpen(false)}>
          <BrandMark />
        </Link>
        <button className="text-ink-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <div className="mx-3 mb-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <div className="truncate text-[12px] font-medium text-ink-200">{businessName}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[10.5px]">
          {paused ? (
            <>
              <PauseCircle size={11} className="text-warn" />
              <span className="text-warn">Publishing paused</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              <span className="text-ink-400">Autopilot active</span>
            </>
          )}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-3">
            <div className="px-2.5 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-ink-500">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors',
                      active
                        ? 'bg-gold-500/[0.12] font-medium text-gold-100'
                        : 'text-ink-300 hover:bg-white/[0.04] hover:text-ink-100'
                    )}
                  >
                    <Icon size={15} className={active ? 'text-gold-400' : 'text-ink-500 group-hover:text-ink-300'} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] text-ink-400">
                        {item.badge}
                      </span>
                    ) : null}
                    {active ? <ChevronRight size={12} className="text-gold-500/70" /> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <div className="mb-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gold-500/25 bg-gold-500/10 text-[11px] font-semibold text-gold-200">
            {(user.name || 'A').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-ink-200">{user.name}</div>
            <div className="truncate text-[10.5px] text-ink-500">{user.email}</div>
          </div>
        </div>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-ink-400 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          <LogOut size={14} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.06] bg-obsidian-950/85 px-4 backdrop-blur-md lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ink-300 hover:bg-white/5" aria-label="Open menu">
          <Menu size={18} />
        </button>
        <BrandMark compact={false} />
        <Link href="/dashboard/assistant" className="rounded-lg p-2 text-gold-300 hover:bg-white/5" aria-label="AI assistant">
          <Sparkles size={17} />
        </Link>
      </div>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] border-r border-white/[0.06] bg-obsidian-900/70 backdrop-blur-xl lg:block">
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[86%] max-w-[300px] border-r border-white/10 bg-obsidian-900">
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}

export function PausedBanner({ paused }: { paused: boolean }) {
  if (!paused) return null;
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn/[0.07] px-4 py-3 text-[12.5px] text-[#f0dcb6]">
      <PauseCircle size={16} className="mt-0.5 shrink-0" />
      <div>
        <span className="font-medium">Publishing is paused globally.</span> Scheduled jobs will not be sent to any
        platform until you resume in{' '}
        <Link href="/dashboard/settings" className="underline decoration-warn/40 underline-offset-2">
          Settings → Publishing
        </Link>
        .
      </div>
      <Badge tone="amber" className="ml-auto hidden sm:inline-flex">
        Pause all
      </Badge>
    </div>
  );
}
