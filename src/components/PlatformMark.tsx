import { cn } from '@/components/ui';

/** Recognisable monogram mark per platform (no external logo assets required). */
const BRAND: Record<string, { color: string; short: string }> = {
  wordpress: { color: '#21759b', short: 'W' },
  blogger: { color: '#f57c00', short: 'B' },
  telegram: { color: '#229ed9', short: 'T' },
  discord: { color: '#5865f2', short: 'D' },
  bluesky: { color: '#1185fe', short: 'B' },
  mastodon: { color: '#6364ff', short: 'M' },
  tumblr: { color: '#35465c', short: 't' },
  devto: { color: '#e7e9ea', short: 'DEV' },
  hashnode: { color: '#2962ff', short: 'H' },
  ghost: { color: '#8e8e93', short: 'G' },
  pinterest: { color: '#e60023', short: 'P' },
  linkedin: { color: '#0a66c2', short: 'in' },
  googlebusiness: { color: '#4285f4', short: 'G' },
  x: { color: '#e7e9ea', short: 'X' },
  flickr: { color: '#ff0084', short: 'fl' },
  youtube: { color: '#ff0000', short: '▶' },
  slack: { color: '#611f69', short: 'S' },
  matrix: { color: '#0dbd8b', short: 'M' },
  behance: { color: '#1769ff', short: 'Be' },
  dribbble: { color: '#ea4c89', short: 'Dr' },
  quora: { color: '#b92b27', short: 'Q' },
  reddit: { color: '#ff4500', short: 'R' },
  indiamart: { color: '#2e3192', short: 'IM' },
  justdial: { color: '#0076c8', short: 'JD' },
  goodfirms: { color: '#ff6b00', short: 'GF' },
};

export function PlatformMark({
  id,
  name,
  size = 'md',
  className,
}: {
  id: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const brand = BRAND[id] ?? { color: '#8c8c99', short: (name ?? id).slice(0, 2) };
  const dims = size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-11 w-11 text-[13px]' : 'h-9 w-9 text-[11px]';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border font-semibold tracking-tight',
        dims,
        className
      )}
      style={{
        color: brand.color,
        borderColor: `${brand.color}44`,
        backgroundColor: `${brand.color}18`,
      }}
      aria-hidden="true"
      title={name}
    >
      {brand.short}
    </div>
  );
}
