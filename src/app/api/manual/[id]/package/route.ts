import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { all, get, json } from '@/lib/db';
import { absoluteMediaPath, readDerivative } from '@/lib/media/storage';
import { getAdapter } from '@/lib/platforms';
import { businessProfile, getSettings } from '@/lib/settings';
import { buildPlatformImage, presetFor } from '@/lib/media/process';
import { manualOut } from '@/lib/serialize';
import JSZip from 'jszip';
import fs from 'node:fs';

export const dynamic = 'force-dynamic';

/**
 * Download a ready-to-publish package for a manual platform:
 * image(s) + copy files + platform instructions, bundled as a ZIP.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;

  const task = get<Record<string, unknown>>(
    `SELECT mt.*, c.name AS campaign_name, p.name AS platform_name, c.user_id AS owner_id,
            c.website_url, c.whatsapp_url, c.contact_info, c.cta
       FROM manual_tasks mt
       JOIN campaigns c ON c.id = mt.campaign_id
       JOIN platforms p ON p.id = mt.platform_id
      WHERE mt.id = ? AND c.user_id = ?`,
    id,
    session.user.id
  );
  if (!task) return new Response('Not found', { status: 404 });

  const content = get<Record<string, unknown>>(
    'SELECT * FROM generated_contents WHERE id = ?',
    String(task.content_id ?? '')
  );
  const adapter = getAdapter(String(task.platform_id));
  const settings = getSettings(session.user.id);
  const business = businessProfile(settings);
  const media = all<{ id: string; filename: string; mime: string; kind: string; original_name: string }>(
    'SELECT id, filename, mime, kind, original_name FROM media_assets WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY created_at',
    String(task.campaign_id)
  );

  const zip = new JSZip();
  const platformName = String(task.platform_name);
  const preset = presetFor(String(task.platform_id));
  const folder = zip.folder(`${platformName.replace(/[^\w.-]+/g, '_')}-package`) ?? zip;

  folder.file('README.txt', readme({ platformName, campaignName: String(task.campaign_name), adapter: adapter?.connectInstructions ?? '', manualUrl: adapter?.manualUrl ?? '', preset }));
  folder.file('01-title.txt', String(content?.title ?? ''));
  folder.file('02-caption.txt', String(content?.caption ?? ''));
  folder.file('03-description.txt', String(content?.description ?? ''));
  folder.file('04-hashtags.txt', json<string[]>(String(content?.hashtags_json ?? '[]'), []).map((h) => `#${h.replace(/^#/, '')}`).join(' '));
  folder.file(
    '05-links-and-contact.txt',
    [
      `Website: ${String(task.website_url || business.websiteUrl || '')}`,
      business.publicContactVisible ? `WhatsApp: ${String(task.whatsapp_url || business.whatsappUrl || '')}` : 'WhatsApp: (not published — public contact is disabled in Settings)',
      business.publicContactVisible ? `Email: ${business.contactEmail}` : '',
      business.publicContactVisible ? `Phone: ${business.contactPhone}` : '',
      `CTA: ${String(task.cta || business.ctaPrimary)}`,
      '',
      'Only contact details explicitly approved in Settings → Business are included here.',
    ]
      .filter(Boolean)
      .join('\n')
  );
  folder.file('06-platform-instructions.txt', `${adapter?.name ?? platformName}\n${'-'.repeat(40)}\n${adapter?.notes ?? ''}\n\nHow to publish:\n${adapter?.connectInstructions ?? ''}\n\nOpen: ${adapter?.manualUrl ?? ''}\n`);

  let imageCount = 0;
  for (const item of media.filter((m) => m.kind === 'image')) {
    try {
      let buffer = readDerivative(item.id, String(task.platform_id));
      if (!buffer) {
        buffer = (await buildPlatformImage(fs.readFileSync(absoluteMediaPath(item.filename)), String(task.platform_id))).buffer;
      }
      const base = item.original_name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'poster';
      folder.file(`image-${imageCount + 1}-${base}-${preset.width}x${preset.height}.jpg`, buffer);
      imageCount += 1;
    } catch {
      /* skip unreadable media */
    }
  }
  if (!imageCount) {
    folder.file('IMAGES-MISSING.txt', 'No image could be packaged for this campaign. Attach a poster and try again.');
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const filename = `${platformName.replace(/[^\w.-]+/g, '-')}-package.zip`;
  void manualOut;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

function readme(opts: { platformName: string; campaignName: string; adapter: string; manualUrl: string; preset: { width: number; height: number; note: string } }) {
  return `${opts.platformName} publishing package
${'='.repeat(48)}

Campaign: ${opts.campaignName}
Prepared by ROYALWEB AUTOPILOT on ${new Date().toISOString()}
Image: ${opts.preset.width}×${opts.preset.height} (${opts.preset.note}) — the full poster is contained, never cropped.

Files in this package
---------------------
01-title.txt         Title / project name
02-caption.txt       Ready-to-paste caption
03-description.txt   Long description or article body
04-hashtags.txt      Tags
05-links-and-contact.txt  Approved links and contact details
06-platform-instructions.txt  How to publish here
image-*.jpg          Platform-sized image(s)

How to publish
--------------
${opts.adapter}

Open the platform: ${opts.manualUrl}

ROYALWEB does not automate logins, CAPTCHAs or posting on this platform.
After publishing, return to the dashboard and mark the task as published.
`;
}
