import 'server-only';
import sharp from 'sharp';

export interface ImageAnalysis {
  width: number;
  height: number;
  format: string;
  aspectRatio: number;
  orientation: 'landscape' | 'portrait' | 'square';
  dominantColor: string;
  palette: string[];
  brightness: number;
  hasAlpha: boolean;
  bytes: number;
}

/**
 * Platform media presets. Posters are always *contained* inside the canvas —
 * never cropped, never stretched — so business names, prices and phone numbers
 * on the original artwork stay intact.
 */
export const MEDIA_PRESETS: Record<string, { width: number; height: number; note: string }> = {
  wordpress: { width: 1200, height: 630, note: 'Featured image 1200×630' },
  blogger: { width: 1200, height: 630, note: 'Blog header 1200×630' },
  telegram: { width: 1280, height: 720, note: 'Channel photo 1280×720' },
  discord: { width: 1200, height: 630, note: 'Embed image 1200×630' },
  bluesky: { width: 1200, height: 675, note: 'Bluesky 16:9, under 1 MB' },
  mastodon: { width: 1200, height: 675, note: 'Mastodon 16:9' },
  tumblr: { width: 1080, height: 1350, note: 'Tumblr 4:5' },
  devto: { width: 1200, height: 630, note: 'DEV cover 1200×630' },
  hashnode: { width: 1200, height: 630, note: 'Hashnode cover 1200×630' },
  ghost: { width: 1200, height: 630, note: 'Ghost feature image' },
  pinterest: { width: 1000, height: 1500, note: 'Pinterest 2:3 pin' },
  linkedin: { width: 1200, height: 627, note: 'LinkedIn 1.91:1' },
  googlebusiness: { width: 1200, height: 900, note: 'Google post photo 4:3' },
  x: { width: 1600, height: 900, note: 'X 16:9' },
  flickr: { width: 2048, height: 1365, note: 'Flickr 3:2, high resolution' },
  youtube: { width: 1080, height: 1920, note: 'Shorts 9:16 (video frame)' },
  slack: { width: 1200, height: 630, note: 'Slack preview 1200×630' },
  matrix: { width: 1200, height: 630, note: 'Matrix image' },
  behance: { width: 1400, height: 1400, note: 'Behance project cover' },
  dribbble: { width: 1600, height: 1200, note: 'Dribbble shot 4:3' },
  quora: { width: 1200, height: 630, note: 'Quora image' },
  reddit: { width: 1200, height: 630, note: 'Reddit image post' },
  indiamart: { width: 1000, height: 1000, note: 'IndiaMART listing 1:1' },
  justdial: { width: 1200, height: 900, note: 'Justdial listing 4:3' },
  goodfirms: { width: 1200, height: 630, note: 'GoodFirms profile image' },
};

export function presetFor(platformId: string) {
  return MEDIA_PRESETS[platformId] ?? { width: 1200, height: 630, note: 'Standard social image' };
}

export async function analyzeImage(buffer: Buffer): Promise<ImageAnalysis> {
  const image = sharp(buffer, { failOn: 'none' });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const stats = await image.stats().catch(() => null);
  const dominant = stats?.dominant
    ? rgbToHex(stats.dominant.r, stats.dominant.g, stats.dominant.b)
    : '#101014';
  const palette =
    stats?.dominant
      ? [dominant, rgbToHex(...(stats.channels.slice(0, 3).map((c) => Math.round(c.mean)) as [number, number, number]))]
      : [dominant];
  const brightness = stats
    ? Number(
        (
          stats.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) /
          3 /
          255
        ).toFixed(3)
      )
    : 0.5;
  const aspectRatio = width && height ? Number((width / height).toFixed(3)) : 1;
  return {
    width,
    height,
    format: meta.format ?? 'unknown',
    aspectRatio,
    orientation: aspectRatio > 1.05 ? 'landscape' : aspectRatio < 0.95 ? 'portrait' : 'square',
    dominantColor: dominant,
    palette: [...new Set(palette)],
    brightness,
    hasAlpha: Boolean(meta.hasAlpha),
    bytes: buffer.length,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Build a platform-optimised copy:
 *  - blurred, darkened, cover-scaled copy of the poster as the backdrop
 *  - the full original poster contained inside it (no cropping, no distortion)
 *  - a thin champagne-gold frame
 */
export async function buildPlatformImage(
  buffer: Buffer,
  platformId: string
): Promise<{ buffer: Buffer; width: number; height: number; note: string }> {
  const preset = presetFor(platformId);
  const { width, height } = preset;

  const backdrop = await sharp(buffer)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .blur(34)
    .modulate({ brightness: 0.32, saturation: 0.8 })
    .toColourspace('srgb')
    .toBuffer();

  // Poster occupies ~86% of the canvas, keeping its aspect ratio exactly.
  const maxW = Math.round(width * 0.86);
  const maxH = Math.round(height * 0.86);
  const poster = await sharp(buffer)
    .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: false })
    .toColourspace('srgb')
    .toBuffer();
  const posterMeta = await sharp(poster).metadata();
  const pw = posterMeta.width ?? maxW;
  const ph = posterMeta.height ?? maxH;
  const left = Math.round((width - pw) / 2);
  const top = Math.round((height - ph) / 2);

  const frameSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <rect x="${left - 2}" y="${top - 2}" width="${pw + 4}" height="${ph + 4}" fill="none" stroke="#c5a059" stroke-opacity="0.55" stroke-width="2"/>
     </svg>`
  );

  const out = await sharp(backdrop)
    .composite([
      { input: poster, left, top },
      { input: frameSvg, left: 0, top: 0 },
    ])
    .jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return { buffer: out, width, height, note: preset.note };
}

export async function buildThumbnail(buffer: Buffer, size = 520): Promise<Buffer> {
  return sharp(buffer)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer();
}
