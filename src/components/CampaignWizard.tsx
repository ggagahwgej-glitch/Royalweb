'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ImagePlus,
  Info,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  api,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Select,
  Spinner,
  Textarea,
  cn,
  useToast,
} from '@/components/ui';
import { PlatformMark } from '@/components/PlatformMark';

interface UploadedMedia {
  id: string;
  originalName: string;
  previewUrl: string;
  width?: number | null;
  height?: number | null;
  bytes: number;
  kind: string;
}

interface PlatformRow {
  id: string;
  name: string;
  group: string;
  automation: string;
  accountCount: number;
  enabled: boolean;
  status: string;
}

interface WizardDefaults {
  websiteUrl: string;
  whatsappUrl: string;
  cta: string;
  language: string;
  timezone: string;
  priceMin: string;
  priceMax: string;
  services: string[];
  targetCustomers: string[];
  publicContactVisible: boolean;
}

const STEPS = ['Media', 'Campaign details', 'Platforms', 'Generate'] as const;

export function CampaignWizard({ defaults }: { defaults: WizardDefaults }) {
  const router = useRouter();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [media, setMedia] = useState<UploadedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'automatic' | 'manual' | 'connected'>('all');
  const [loadingPlatforms, setLoadingPlatforms] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [details, setDetails] = useState({
    name: '',
    businessCategory: defaults.targetCustomers[0] ?? '',
    serviceName: defaults.services[0] ?? '',
    offerPrice:
      defaults.priceMin && defaults.priceMax ? `₹${defaults.priceMin}–₹${defaults.priceMax}` : '',
    websiteUrl: defaults.websiteUrl,
    whatsappUrl: defaults.whatsappUrl,
    contactInfo: '',
    description: '',
    targetAudience: '',
    language: defaults.language,
    cta: defaults.cta,
    timezone: defaults.timezone,
  });

  useEffect(() => {
    api<{ platforms: PlatformRow[] }>('/api/platforms')
      .then((data) => {
        setPlatforms(data.platforms);
        setSelected(
          new Set(data.platforms.filter((p) => p.automation !== 'manual' && p.accountCount > 0).map((p) => p.id))
        );
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingPlatforms(false));
  }, []);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        list.forEach((file) => form.append('files', file));
        const data = await api<{ uploaded: UploadedMedia[]; rejected: { name: string; reason: string }[] }>('/api/media', {
          method: 'POST',
          formData: form,
        });
        setMedia((prev) => [...prev, ...data.uploaded]);
        if (data.rejected?.length) {
          data.rejected.forEach((r) => push(`${r.name}: ${r.reason}`, 'error'));
        } else {
          push(`${data.uploaded.length} file${data.uploaded.length > 1 ? 's' : ''} uploaded — original preserved`, 'success');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [push]
  );

  const filtered = useMemo(() => {
    return platforms.filter((p) => {
      if (filter === 'automatic') return p.automation !== 'manual';
      if (filter === 'manual') return p.automation === 'manual';
      if (filter === 'connected') return p.accountCount > 0;
      return true;
    });
  }, [platforms, filter]);

  const connectedCount = platforms.filter((p) => p.accountCount > 0).length;
  const automaticSelected = [...selected].filter(
    (id) => platforms.find((p) => p.id === id)?.automation !== 'manual'
  ).length;
  const manualSelected = selected.size - automaticSelected;
  const canContinue =
    step === 0 ? media.length > 0 : step === 1 ? details.name.trim().length > 0 : step === 2 ? selected.size > 0 : true;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectPreset(kind: 'all' | 'automatic' | 'manual' | 'connected' | 'none') {
    if (kind === 'none') return setSelected(new Set());
    if (kind === 'all') return setSelected(new Set(platforms.map((p) => p.id)));
    if (kind === 'automatic') return setSelected(new Set(platforms.filter((p) => p.automation !== 'manual').map((p) => p.id)));
    if (kind === 'manual') return setSelected(new Set(platforms.filter((p) => p.automation === 'manual').map((p) => p.id)));
    setSelected(new Set(platforms.filter((p) => p.accountCount > 0).map((p) => p.id)));
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const created = await api<{ campaign: { id: string } }>('/api/campaigns', {
        method: 'POST',
        body: {
          ...details,
          name: details.name.trim(),
          mediaIds: media.map((m) => m.id),
        },
      });
      const campaignId = created.campaign.id;
      await api(`/api/campaigns/${campaignId}/generate`, {
        method: 'POST',
        body: { platforms: [...selected] },
      });
      push('Content generated for review', 'success');
      router.push(`/dashboard/campaigns/${campaignId}?generated=1`);
    } catch (err) {
      setError((err as Error).message);
      setGenerating(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        {/* Steps */}
        <div className="mb-4 flex items-center gap-1 overflow-x-auto pb-1">
          {STEPS.map((label, index) => (
            <div key={label} className="flex items-center gap-1">
              <button
                onClick={() => index < step && setStep(index)}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11.5px] transition-colors',
                  index === step
                    ? 'bg-gold-500/[0.12] text-gold-100'
                    : index < step
                      ? 'text-ink-300 hover:bg-white/[0.04]'
                      : 'text-ink-500'
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                    index === step
                      ? 'border-gold-500/50 bg-gold-500/20 text-gold-200'
                      : index < step
                        ? 'border-ok/40 bg-ok/10 text-ok'
                        : 'border-white/10 text-ink-500'
                  )}
                >
                  {index < step ? <Check size={11} /> : index + 1}
                </span>
                {label}
              </button>
              {index < STEPS.length - 1 ? <ArrowRight size={11} className="text-ink-600" /> : null}
            </div>
          ))}
        </div>

        {error ? (
          <div className="mb-4">
            <Notice tone="red">{error}</Notice>
          </div>
        ) : null}

        {step === 0 ? (
          <Card className="p-5">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files) void upload(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors',
                dragging ? 'border-gold-500/60 bg-gold-500/[0.06]' : 'border-white/[0.12] bg-white/[0.015] hover:border-white/20'
              )}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,video/mp4"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void upload(e.target.files);
                  e.target.value = '';
                }}
              />
              {uploading ? (
                <>
                  <Loader2 size={22} className="mb-2 animate-spin text-gold-400" />
                  <p className="text-[13px] text-ink-200">Uploading and analysing…</p>
                </>
              ) : (
                <>
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gold-500/25 bg-gold-500/10">
                    <ImagePlus size={19} className="text-gold-300" />
                  </div>
                  <p className="text-[13.5px] font-medium text-ink-100">Drop your poster here, or tap to choose</p>
                  <p className="mt-1 text-[11.5px] text-ink-400">JPG, PNG, WEBP up to 25 MB · MP4 up to 200 MB</p>
                </>
              )}
            </div>

            <div className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-400">
              <Info size={13} className="mt-0.5 shrink-0 text-gold-500" />
              The original file is stored untouched. Platform versions are generated as separate copies — never
              stretched and never cropped, so your headline, price and phone number stay intact.
            </div>

            {media.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((item) => (
                  <div key={item.id} className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-obsidian-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt={item.originalName} className="h-32 w-full object-cover" />
                    <button
                      onClick={() => setMedia((prev) => prev.filter((m) => m.id !== item.id))}
                      className="absolute right-1.5 top-1.5 rounded-lg bg-black/70 p-1.5 text-ink-200 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      aria-label="Remove from campaign"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div className="px-2.5 py-2">
                      <div className="truncate text-[11px] text-ink-200">{item.originalName}</div>
                      <div className="text-[10px] text-ink-500">
                        {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
                        {(item.bytes / 1024).toFixed(0)} KB
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}

        {step === 1 ? (
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Campaign name" required hint="Internal label, e.g. “Restaurant Website Offer — November”.">
                  <Input
                    value={details.name}
                    onChange={(e) => setDetails({ ...details, name: e.target.value })}
                    placeholder="Restaurant Website Offer"
                  />
                </Field>
              </div>
              <Field label="Business category">
                <Input
                  value={details.businessCategory}
                  onChange={(e) => setDetails({ ...details, businessCategory: e.target.value })}
                  placeholder="Restaurants"
                  list="category-options"
                />
                <datalist id="category-options">
                  {defaults.targetCustomers.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Service name">
                <Input
                  value={details.serviceName}
                  onChange={(e) => setDetails({ ...details, serviceName: e.target.value })}
                  placeholder="Restaurant Website Development"
                  list="service-options"
                />
                <datalist id="service-options">
                  {defaults.services.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Offer price">
                <Input
                  value={details.offerPrice}
                  onChange={(e) => setDetails({ ...details, offerPrice: e.target.value })}
                  placeholder="₹2,999 – ₹4,999"
                />
              </Field>
              <Field label="CTA">
                <Input
                  value={details.cta}
                  onChange={(e) => setDetails({ ...details, cta: e.target.value })}
                  placeholder="Get Your Business Website"
                />
              </Field>
              <Field label="Website URL">
                <Input
                  type="url"
                  value={details.websiteUrl}
                  onChange={(e) => setDetails({ ...details, websiteUrl: e.target.value })}
                  placeholder="https://royalweb.in"
                />
              </Field>
              <Field label="WhatsApp URL" hint={defaults.publicContactVisible ? undefined : 'Hidden until public contact is enabled in Settings → Business.'}>
                <Input
                  type="url"
                  value={details.whatsappUrl}
                  onChange={(e) => setDetails({ ...details, whatsappUrl: e.target.value })}
                  placeholder="https://wa.me/91XXXXXXXXXX"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Contact information" hint="Only published if public contact is enabled in Settings.">
                  <Input
                    value={details.contactInfo}
                    onChange={(e) => setDetails({ ...details, contactInfo: e.target.value })}
                    placeholder="Email / phone to show in the content"
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Campaign description"
                  hint="Optional. What should the AI emphasise? Leave blank and it will use the poster and your business profile."
                >
                  <Textarea
                    value={details.description}
                    onChange={(e) => setDetails({ ...details, description: e.target.value })}
                    placeholder="Limited-period offer for restaurants that need a mobile-first website with a menu, gallery and WhatsApp ordering button."
                  />
                </Field>
              </div>
              <Field label="Target audience">
                <Input
                  value={details.targetAudience}
                  onChange={(e) => setDetails({ ...details, targetAudience: e.target.value })}
                  placeholder="Restaurant owners in Guwahati"
                />
              </Field>
              <Field label="Preferred language">
                <Select value={details.language} onChange={(e) => setDetails({ ...details, language: e.target.value })}>
                  {['English', 'Hindi', 'Assamese', 'Bengali', 'Marathi', 'Tamil', 'Telugu', 'Gujarati'].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Timezone">
                <Select value={details.timezone} onChange={(e) => setDetails({ ...details, timezone: e.target.value })}>
                  {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
              Every field is optional except the campaign name. The AI uses only what you provide — it will not
              invent prices, phone numbers or client claims.
            </p>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(
                [
                  ['all', `All 25`],
                  ['automatic', 'Automatic only'],
                  ['manual', 'Manual only'],
                  ['connected', `Connected (${connectedCount})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors',
                    filter === key
                      ? 'border-gold-500/40 bg-gold-500/10 text-gold-200'
                      : 'border-white/[0.08] text-ink-400 hover:bg-white/[0.04]'
                  )}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-500">
                <button className="rounded px-1.5 py-1 hover:text-gold-300" onClick={() => selectPreset('all')}>
                  Select all
                </button>
                ·
                <button className="rounded px-1.5 py-1 hover:text-gold-300" onClick={() => selectPreset('automatic')}>
                  Auto
                </button>
                ·
                <button className="rounded px-1.5 py-1 hover:text-gold-300" onClick={() => selectPreset('manual')}>
                  Manual
                </button>
                ·
                <button className="rounded px-1.5 py-1 hover:text-gold-300" onClick={() => selectPreset('connected')}>
                  Connected
                </button>
                ·
                <button className="rounded px-1.5 py-1 hover:text-danger" onClick={() => selectPreset('none')}>
                  Clear
                </button>
              </span>
            </div>

            {loadingPlatforms ? (
              <div className="py-8">
                <Spinner label="Loading platforms…" />
              </div>
            ) : (
              <div className="grid max-h-[460px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {filtered.map((platform) => {
                  const active = selected.has(platform.id);
                  return (
                    <button
                      key={platform.id}
                      onClick={() => toggle(platform.id)}
                      className={cn(
                        'flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
                        active
                          ? 'border-gold-500/40 bg-gold-500/[0.07]'
                          : 'border-white/[0.07] bg-white/[0.015] hover:border-white/[0.14]'
                      )}
                    >
                      <PlatformMark id={platform.id} name={platform.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-ink-100">{platform.name}</span>
                          <span
                            className={cn(
                              'ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              active ? 'border-gold-400 bg-gold-500 text-obsidian-950' : 'border-white/15'
                            )}
                          >
                            {active ? <Check size={10} strokeWidth={3} /> : null}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {platform.automation === 'manual' ? (
                            <Badge tone="purple">Manual</Badge>
                          ) : platform.accountCount > 0 ? (
                            <Badge tone="green">Connected</Badge>
                          ) : platform.automation === 'approval' ? (
                            <Badge tone="amber">Approval</Badge>
                          ) : (
                            <Badge tone="neutral">No account</Badge>
                          )}
                          {platform.automation === 'manual' ? (
                            <span className="text-[9.5px] text-ink-500">package prepared</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
              {selected.size} selected · {automaticSelected} can publish via API · {manualSelected} will be prepared
              for manual publishing. Platforms without a connected account will be created as jobs that require an
              account — nothing is silently skipped.
            </p>
          </Card>
        ) : null}

        {step === 3 ? (
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold-500/25 bg-gold-500/10">
                <Wand2 size={18} className="text-gold-300" />
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-ink-100">Ready to generate</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">
                  ROYALWEB will analyse the poster, build platform-sized images and write a distinct version for
                  each platform. You will review and approve everything before any job is created.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink-500">Poster</div>
                <div className="mt-1 text-[13px] text-ink-100">{media.length} file(s)</div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink-500">Platforms</div>
                <div className="mt-1 text-[13px] text-ink-100">{selected.size} selected</div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink-500">Campaign</div>
                <div className="mt-1 truncate text-[13px] text-ink-100">{details.name || '—'}</div>
              </div>
            </div>

            <div className="mt-4">
              <Notice tone="gold" title="What happens next">
                Content is generated as editable drafts. Nothing goes live until you approve each platform and
                schedule the campaign. If no AI provider is configured, the built-in template engine is used and
                clearly labelled.
              </Notice>
            </div>
          </Card>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || generating}>
            <ArrowLeft size={14} /> Back
          </Button>
          {step < 3 ? (
            <Button variant="gold" onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
              Continue <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              variant="gold"
              onClick={generate}
              loading={generating}
              disabled={!media.length || !selected.size || !details.name.trim()}
              icon={<Sparkles size={15} />}
            >
              {generating ? 'Generating platform content…' : 'Generate content'}
            </Button>
          )}
        </div>
        {generating ? (
          <p className="mt-3 text-right text-[11px] text-ink-500">
            Generating 25 versions can take up to a minute. Keep this tab open.
          </p>
        ) : null}
      </div>

      {/* Sidebar summary */}
      <div className="space-y-3">
        <Card className="p-4">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-500">Campaign summary</div>
          <div className="mt-3 space-y-2.5 text-[12px]">
            <Row label="Poster(s)" value={`${media.length}`} />
            <Row label="Platforms" value={`${selected.size}`} />
            <Row label="Auto publish" value={`${automaticSelected}`} />
            <Row label="Manual package" value={`${manualSelected}`} />
            <Row label="Language" value={details.language} />
            <Row label="Timezone" value={details.timezone} />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-ink-200">
            <CheckCircle2 size={14} className="text-gold-400" /> Built-in safeguards
          </div>
          <ul className="mt-2.5 space-y-2 text-[11.5px] leading-relaxed text-ink-400">
            <li>• Originals are never overwritten.</li>
            <li>• Duplicate-content detection before publishing.</li>
            <li>• Nothing publishes without explicit approval.</li>
            <li>• Failed platforms are reported, never hidden.</li>
          </ul>
        </Card>

        <div className="hidden lg:block">
          <Button variant="secondary" className="w-full" onClick={() => router.push('/dashboard/media')} icon={<Upload size={14} />}>
            Open media library
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-400">{label}</span>
      <span className="truncate font-medium text-ink-100">{value}</span>
    </div>
  );
}
