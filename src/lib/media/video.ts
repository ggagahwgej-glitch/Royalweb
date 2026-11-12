import 'server-only';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MEDIA_PRESETS } from './process';

/**
 * Vertical Shorts renderer.
 *
 * A static poster is NOT a Short. This module turns the poster into a real
 * 1080×1920 MP4 clip (12 s, subtle zoom) using ffmpeg. If ffmpeg is missing,
 * rendering fails loudly so the publishing engine can mark the platform as
 * needing a manual video — it never reports a fake success.
 */

export async function ffmpegPath(): Promise<string | null> {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    // Optional dependency — only present when installed by the operator.
    const moduleName = 'ffmpeg-static';
    const mod = (await import(/* webpackIgnore: true */ moduleName)) as unknown as { default?: string };
    if (mod?.default && fs.existsSync(mod.default)) return mod.default;
  } catch {
    /* not installed */
  }
  return null;
}

export async function renderShortFromImage(
  imageBuffer: Buffer,
  options: { seconds?: number; title?: string } = {}
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const bin = await ffmpegPath();
  if (!bin) {
    return {
      ok: false,
      error:
        'No video renderer available. Install ffmpeg on the server (or `npm i ffmpeg-static`) to convert posters into Shorts, or upload an MP4 to the campaign.',
    };
  }
  const { width, height } = MEDIA_PRESETS.youtube;
  const seconds = Math.min(Math.max(options.seconds ?? 12, 5), 60);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'royalweb-short-'));
  const imgPath = path.join(dir, 'poster.png');
  const outPath = path.join(dir, 'short.mp4');
  try {
    // Normalise the poster to PNG so ffmpeg always has a decodable input.
    const sharp = (await import('sharp')).default;
    await sharp(imageBuffer).png().toFile(imgPath);

    const filter = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0e`,
      'format=yuv420p',
    ].join(',');

    await runFfmpeg(bin, [
      '-y',
      '-loop', '1',
      '-i', imgPath,
      '-t', String(seconds),
      '-vf', filter,
      '-r', '30',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath,
    ]);
    const buffer = fs.readFileSync(outPath);
    if (!buffer.length) return { ok: false, error: 'ffmpeg produced an empty file.' };
    return { ok: true, buffer };
  } catch (err) {
    return { ok: false, error: `Video rendering failed: ${(err as Error).message}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += String(d).slice(0, 4000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timed out after 120s'));
    }, 120_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.split('\n').filter(Boolean).slice(-4).join(' ') || `ffmpeg exited with ${code}`));
    });
  });
}
