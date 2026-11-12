import { NextRequest } from 'next/server';
import { handler, jsonOk, ApiError } from '@/lib/api';
import { all, get, newId, nowIso, run } from '@/lib/db';
import { analyzeImage } from '@/lib/media/process';
import { saveOriginal, signedMediaUrl } from '@/lib/media/storage';
import { sha256Buffer } from '@/lib/crypto';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_VIDEO = 200 * 1024 * 1024;

export const GET = handler(async (req, _ctx, auth) => {
  const url = new URL(req.url);
  const campaignId = url.searchParams.get('campaignId');
  const q = url.searchParams.get('q');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: string[] = [
    'm.deleted_at IS NULL',
    '(m.workspace_id = ? OR (m.workspace_id IS NULL AND ? = (SELECT active_workspace_id FROM users WHERE id = ?)))',
  ];
  const params: unknown[] = [auth.workspaceId, auth.workspaceId, auth.user.id];
  if (campaignId) {
    where.push('m.campaign_id = ?');
    params.push(campaignId);
  }
  if (q) {
    where.push('(lower(m.original_name) LIKE ? OR lower(m.alt_text) LIKE ?)');
    params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  if (from) {
    where.push('m.created_at >= ?');
    params.push(from);
  }
  if (to) {
    where.push('m.created_at <= ?');
    params.push(to);
  }
  const rows = all(
    `SELECT m.*, c.name AS campaign_name, c.status AS campaign_status,
        (SELECT COUNT(*) FROM media_derivatives d WHERE d.media_id = m.id) AS derivative_count
       FROM media_assets m LEFT JOIN campaigns c ON c.id = m.campaign_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.created_at DESC LIMIT 200`,
    ...params
  );
  return jsonOk({ media: rows });
});

export const POST = handler(async (req, ctx, auth) => {
  enforceRateLimit(`upload:${auth.user.id}`, 60, 300);
  const form = await req.formData().catch(() => null);
  if (!form) throw new ApiError(400, 'Expected multipart/form-data upload', 'bad_upload');
  const campaignId = String(form.get('campaignId') ?? '') || null;
  if (campaignId) {
    const campaign = get<{ id: string }>('SELECT id FROM campaigns WHERE id = ? AND user_id = ?', campaignId, auth.user.id);
    if (!campaign) throw new ApiError(404, 'Campaign not found', 'campaign_not_found');
  }
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!files.length) throw new ApiError(400, 'No files were uploaded', 'no_files');
  if (files.length > 12) throw new ApiError(400, 'Upload at most 12 files at a time', 'too_many_files');

  const created: Record<string, unknown>[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    const type = (file.type || '').toLowerCase();
    const isImage = IMAGE_TYPES.includes(type) || /\.(jpe?g|png|webp)$/i.test(file.name);
    const isVideo = VIDEO_TYPES.includes(type) || /\.(mp4|mov|webm)$/i.test(file.name);
    if (!isImage && !isVideo) {
      rejected.push({ name: file.name, reason: 'Unsupported format. Use JPG, PNG, WEBP or MP4.' });
      continue;
    }
    if (isImage && file.size > MAX_IMAGE) {
      rejected.push({ name: file.name, reason: 'Image exceeds the 25 MB limit.' });
      continue;
    }
    if (isVideo && file.size > MAX_VIDEO) {
      rejected.push({ name: file.name, reason: 'Video exceeds the 200 MB limit.' });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = saveOriginal(buffer, file.name);
    const hash = sha256Buffer(buffer);
    const id = newId();
    let width: number | null = null;
    let height: number | null = null;
    let analysis: Record<string, unknown> = {};

    if (isImage) {
      try {
        const stats = await analyzeImage(buffer);
        width = stats.width;
        height = stats.height;
        analysis = { ...stats };
      } catch (err) {
        rejected.push({ name: file.name, reason: `The image could not be decoded: ${(err as Error).message}` });
        continue;
      }
    }

    run(
      `INSERT INTO media_assets (id, campaign_id, user_id, workspace_id, original_name, filename, mime, bytes, width,
         height, kind, sha256, alt_text, analysis_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      id,
      campaignId,
      auth.user.id,
      auth.workspaceId,
      file.name.slice(0, 200),
      filename,
      isImage ? (type || 'image/jpeg') : type || 'video/mp4',
      buffer.length,
      width,
      height,
      isImage ? 'image' : 'video',
      hash,
      JSON.stringify(analysis),
      nowIso()
    );

    const duplicate = get<{ id: string; original_name: string }>(
      'SELECT id, original_name FROM media_assets WHERE sha256 = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
      hash,
      id
    );

    created.push({
      id,
      originalName: file.name,
      mime: type,
      bytes: buffer.length,
      width,
      height,
      kind: isImage ? 'image' : 'video',
      sha256: hash,
      analysis,
      duplicateOf: duplicate ?? null,
      previewUrl: `/api/media/${id}/file`,
    });
  }

  if (!created.length) {
    throw new ApiError(400, rejected.map((r) => `${r.name}: ${r.reason}`).join(' · ') || 'Upload failed', 'upload_rejected', rejected);
  }

  return jsonOk({ uploaded: created, rejected, originalPreserved: true });
});

export const runtime = 'nodejs';
