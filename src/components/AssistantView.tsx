'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Bot, Send, Sparkles, User } from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  Notice,
  PageHeader,
  StatusBadge,
  cn,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';

interface PlanItem {
  platformId: string;
  platformName: string;
  automation: string;
  connection: 'connected' | 'not_connected' | 'manual';
  willPublishAutomatically: boolean;
  contentStatus: string | null;
  note: string;
}

interface AssistantResponse {
  reply: string;
  intent: string;
  aiUsed: boolean;
  aiError: string | null;
  plan: { items: PlanItem[]; suggestedTime: string; timezone: string; campaignId: string | null; requiresApproval: boolean } | null;
  counts: { total: number; connected: number; notConnected: number; manual: number };
  suggestedActions: { id: string; label: string; href?: string }[];
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  response?: AssistantResponse;
}

const SUGGESTIONS = [
  'Plan a campaign for my restaurant website offer tomorrow at 10am',
  'Which platforms are connected right now?',
  'Why did my last post fail?',
  'Pause all publishing',
  'What content would work on LinkedIn for cafe owners?',
];

export function AssistantView() {
  const { push } = useToast();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text:
        'I am ROYALWEB AI Assistant. I can analyse posters, draft platform-specific copy, plan a distribution schedule and explain publishing errors. I will never publish anything without your explicit approval, and I will never claim a post went live unless the platform confirmed it.\n\nAsk me something, or pick one of the suggestions below.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionCounts, setSessionCounts] = useState<AssistantResponse['counts'] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setMessages((prev) => [...prev, { role: 'user', text: message }]);
      setInput('');
      setBusy('send');
      try {
        const response = await api<AssistantResponse>('/api/assistant', { method: 'POST', body: { message } });
        setMessages((prev) => [...prev, { role: 'assistant', text: response.reply, response }]);
        setSessionCounts(response.counts);
      } catch (err) {
        push((err as Error).message, 'error');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `I could not reach the assistant service: ${(err as Error).message}` },
        ]);
      } finally {
        setBusy(null);
      }
    },
    [busy, push]
  );

  async function runAction(action: { id: string; label: string; href?: string }) {
    if (action.href) {
      router.push(action.href);
      return;
    }
    if (action.id === 'global-pause') {
      if (!confirm('Switch the global publishing pause? Scheduled jobs will stop/resume immediately.')) return;
      try {
        const settings = await api<{ settings: { globalPause: boolean } }>('/api/settings');
        await api('/api/settings', { method: 'PATCH', body: { globalPause: !settings.settings.globalPause } });
        push(!settings.settings.globalPause ? 'Publishing paused globally' : 'Publishing resumed', 'success');
        router.refresh();
      } catch (err) {
        push((err as Error).message, 'error');
      }
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="ROYALWEB AI ASSISTANT"
        title="Ask, plan, then approve"
        description="The assistant prepares plans and copy. Publishing only happens after you approve a campaign — that is enforced in code, not just in wording."
        actions={
          sessionCounts ? (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green">{sessionCounts.connected} connected</Badge>
              <Badge tone="amber">{sessionCounts.notConnected} not connected</Badge>
              <Badge tone="purple">{sessionCounts.manual} manual</Badge>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <Card className="flex h-[calc(100dvh-230px)] min-h-[420px] flex-col overflow-hidden">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            {messages.map((message, index) => (
              <div key={index} className={cn('flex gap-2.5', message.role === 'user' && 'flex-row-reverse')}>
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                    message.role === 'user'
                      ? 'border-white/10 bg-white/[0.06] text-ink-300'
                      : 'border-gold-500/30 bg-gold-500/10 text-gold-300'
                  )}
                >
                  {message.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                </div>
                <div className={cn('min-w-0 max-w-[88%]', message.role === 'user' && 'text-right')}>
                  <div
                    className={cn(
                      'inline-block whitespace-pre-wrap rounded-2xl border px-3.5 py-2.5 text-left text-[12.5px] leading-relaxed',
                      message.role === 'user'
                        ? 'border-white/[0.08] bg-white/[0.05] text-ink-100'
                        : 'border-white/[0.06] bg-obsidian-800/80 text-ink-200'
                    )}
                  >
                    {message.text}
                  </div>

                  {message.response?.plan ? (
                    <div className="mt-2.5 rounded-xl border border-white/[0.07] bg-obsidian-900/60 p-3 text-left">
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-gold-500">Publishing plan</span>
                        <Badge tone="amber">requires your approval</Badge>
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto">
                        {message.response.plan.items.map((item) => (
                          <div key={item.platformId} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
                            <PlatformMark id={item.platformId} name={item.platformName} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-200">{item.platformName}</span>
                            {item.connection === 'connected' ? (
                              <Badge tone="green">auto</Badge>
                            ) : item.connection === 'manual' ? (
                              <Badge tone="purple">manual</Badge>
                            ) : (
                              <Badge tone="amber">no account</Badge>
                            )}
                            {item.contentStatus ? <StatusBadge status={item.contentStatus} /> : <Badge tone="neutral">no copy</Badge>}
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
                        Suggested slot {new Date(message.response.plan.suggestedTime).toLocaleString()} ·{' '}
                        {message.response.plan.timezone}. Open the campaign to approve and schedule.
                      </p>
                    </div>
                  ) : null}

                  {message.response?.suggestedActions?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.response.suggestedActions.map((action) => (
                        <Button key={action.id} size="sm" variant="secondary" onClick={() => runAction(action)} icon={<ArrowUpRight size={12} />}>
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}

                  {message.response && !message.response.aiUsed && message.role === 'assistant' ? (
                    <div className="mt-1.5 text-[10px] text-ink-600">
                      deterministic plan · template/rule engine{message.response.aiError ? ` · AI error: ${message.response.aiError}` : ''}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {busy === 'send' ? (
              <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
                <Bot size={14} className="text-gold-400" /> thinking…
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-white/[0.06] p-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                placeholder="e.g. Upload this restaurant poster to all connected platforms tomorrow at 10am"
                className="input min-h-[48px] flex-1 resize-none text-[12.5px]"
              />
              <Button type="submit" variant="gold" loading={busy === 'send'} icon={<Send size={14} />}>
                Send
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-600">
              The assistant cannot publish on its own. Approve content in the campaign screen to create jobs.
            </p>
          </form>
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink-200">
              <Sparkles size={14} className="text-gold-400" /> Try asking
            </div>
            <div className="mt-2 space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  disabled={busy === 'send'}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.015] px-2.5 py-2 text-left text-[11.5px] leading-snug text-ink-300 transition-colors hover:border-gold-500/25 hover:text-ink-100 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500">Guardrails</div>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-400">
              <li>• No publishing without approved content</li>
              <li>• No invented prices, numbers or client claims</li>
              <li>• Failures are reported, never hidden</li>
              <li>• Poster text only read when a vision model is configured</li>
            </ul>
          </Card>

          <Notice tone="neutral">
            The assistant runs on your configured AI provider. Without one it answers with deterministic rules and
            clearly says so.
          </Notice>
        </div>
      </div>
    </div>
  );
}
