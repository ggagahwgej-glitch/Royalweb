'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, ImagePlus, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
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
  Textarea,
  useToast,
} from '@/components/ui';

interface MediaRow {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  originalName: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  kind: string;
  altText: string;
  thumbUrl: string;
  fileUrl: string;
  createdAt: string;
  derivativeCount: number;
  analysis: { dominantColor?: string; orientation?: string };
}

interface CampaignRow {
  id: string;
  name: string;
}

export function MediaLibrary() {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<MediaRow[] | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [q, setQ] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<MediaRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ originalName: '', altText: '', campaignId: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (campaignFilter) params.set('campaignId', campaignFilter);
      const data = await api<{ media: MediaRow[] }>(`/api/media?${params.toString()}`);
      setMedia(data.media);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [q, campaignFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ campaigns: CampaignRow[] }>('/api/campaigns')
      .then((data) => setCampaigns(data.campaigns))
      .catch(() => undefined);
  }, []);

  async function upload(files: FileList | File[]) {
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('files', file));
      const data = await api<{ uploaded: MediaRow[]; rejected: { name: string; reason: string }[] }>('/api/media', {
        method: 'POST',
        formData: form,
      });
      push(`${data.uploaded.length} file(s) uploaded — originals stored unchanged`, 'success');
      data.rejected?.forEach((r) => push(`${r.name}: ${r.reason}`, 'error'));
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!selected) return;
    try {
      await api(`/api/media/${selected.id}`, {
        method: 'PATCH',
        body: {
          originalName: draft.originalName,
          altText: draft.altText,
          campaignId: draft.campaignId || null,
        },
      });
      push('Media updated', 'success');
      setEditing(false);
      setSelected(null);
      await load();
    } catch (err) {
      push((err as Error).message, 'error');
    }
  }

  async function remove(row: MediaRow) {
    try {
      await api(`/api/media/${row.id}`, { method: 'DELETE' });
      push('Media removed from the library', 'success');
      setSelected(null);
      await load();
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('scheduled or active')) {
        if (confirm(`${message}\n\nDelete the file permanently anyway?`)) {
          try {
            await api(`/api/media/${row.id}?force=1`, { method: 'DELETE' });
            push('Media permanently deleted', 'success');
            setSelected(null);
            await load();
          } catch (forceErr) {
            push((forceErr as Error).message, 'error');
          }
        }
      } else {
        push(message, 'error');
      }
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Media library"
        description="Every poster you upload is kept forever, unmodified. Platform-optimised copies are generated separately and can be regenerated at any time."
        actions={
          <>
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
            <Button variant="gold" loading={uploading} onClick={() => inputRef.current?.click()} icon={<Upload size={14} />}>
              Upload media
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <Input
              className="pl-9"
              placeholder="Search by filename or alt text…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="sm:w-64">
            <option value="">All campaigns</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
          <Badge tone="neutral">{media?.length ?? 0} files</Badge>
        </div>
      </Card>

      {error ? <Notice tone="red">{error}</Notice> : null}

      {!media ? (
        <div className="py-12">
          <Spinner label="Loading library…" />
        </div>
      ) : media.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ImagePlus size={22} />}
            title="No media yet"
            description="Upload one poster to start. JPG, PNG, WEBP and MP4 are supported; originals are never modified."
            action={
              <Button variant="gold" onClick={() => inputRef.current?.click()} icon={<Upload size={14} />}>
                Upload a poster
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {media.map((row) => (
            <button
              key={row.id}
              onClick={() => {
                setSelected(row);
                setDraft({ originalName: row.originalName, altText: row.altText, campaignId: row.campaignId ?? '' });
                setEditing(false);
              }}
              className="group overflow-hidden rounded-xl border border-white/[0.07] bg-obsidian-850/70 text-left transition-colors hover:border-gold-500/30"
            >
              <div className="relative aspect-square overflow-hidden bg-obsidian-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={row.thumbUrl} alt={row.originalName} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" />
                {row.kind === 'video' ? <Badge tone="blue" className="absolute left-2 top-2">MP4</Badge> : null}
                {row.derivativeCount > 0 ? (
                  <Badge tone="gold" className="absolute right-2 top-2">
                    {row.derivativeCount} vars
                  </Badge>
                ) : null}
              </div>
              <div className="px-2.5 py-2">
                <div className="truncate text-[11.5px] font-medium text-ink-200">{row.originalName}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-500">
                  {row.width && row.height ? `${row.width}×${row.height}` : 'video'} · {(row.bytes / 1024).toFixed(0)} KB
                </div>
                {row.campaignName ? (
                  <div className="mt-0.5 truncate text-[10px] text-gold-500/80">{row.campaignName}</div>
                ) : (
                  <div className="mt-0.5 text-[10px] text-ink-600">unassigned</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.originalName ?? 'Media'}
        wide
        footer={
          selected ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="danger" size="sm" onClick={() => remove(selected)} icon={<Trash2 size={13} />}>
                Delete
              </Button>
              <div className="flex gap-2">
                <a
                  href={selected.fileUrl}
                  download={selected.originalName}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.045] px-3 py-2 text-[12.5px] text-ink-100 hover:bg-white/[0.08]"
                >
                  <Download size={13} /> Download original
                </a>
                {editing ? (
                  <Button variant="gold" size="sm" onClick={save}>Save changes</Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setEditing(true)} icon={<Pencil size={13} />}>Edit details</Button>
                )}
              </div>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-obsidian-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.fileUrl} alt={selected.originalName} className="w-full object-contain" />
            </div>
            <div className="space-y-3">
              {editing ? (
                <>
                  <Field label="File name">
                    <Input value={draft.originalName} onChange={(e) => setDraft({ ...draft, originalName: e.target.value })} />
                  </Field>
                  <Field label="Alt text" hint="Used as the image description on platforms that support it.">
                    <Textarea value={draft.altText} onChange={(e) => setDraft({ ...draft, altText: e.target.value })} className="min-h-[80px]" />
                  </Field>
                  <Field label="Campaign">
                    <Select value={draft.campaignId} onChange={(e) => setDraft({ ...draft, campaignId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {campaigns.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                      ))}
                    </Select>
                  </Field>
                </>
              ) : (
                <dl className="space-y-2 text-[12px]">
                  <Row label="Dimensions" value={selected.width && selected.height ? `${selected.width} × ${selected.height}` : 'video'} />
                  <Row label="Size" value={`${(selected.bytes / 1024).toFixed(0)} KB`} />
                  <Row label="Type" value={selected.mime} />
                  <Row label="Orientation" value={String(selected.analysis?.orientation ?? '—')} />
                  <Row label="Campaign" value={selected.campaignName ?? 'Unassigned'} />
                  <Row label="Optimised copies" value={`${selected.derivativeCount}`} />
                  <Row label="Uploaded" value={new Date(selected.createdAt).toLocaleString()} />
                </dl>
              )}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-ink-400">
                The original is stored byte-for-byte. Delete it only if it is not attached to a scheduled campaign.
              </div>
              <Link href="/dashboard/new" className="inline-block text-[11.5px] text-gold-300 hover:text-gold-200">
                Create a campaign with this poster →
              </Link>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/[0.04] pb-1.5">
      <dt className="text-ink-500">{label}</dt>
      <dd className="max-w-[60%] truncate text-right text-ink-200">{value}</dd>
    </div>
  );
}
