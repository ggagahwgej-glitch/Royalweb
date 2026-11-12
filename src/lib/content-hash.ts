/**
 * Single source of truth for the duplicate-detection fingerprint.
 *
 * It previously differed between generation and manual editing (the edit path
 * dropped hashtags and used stale values), which made the duplicate guard
 * either block copy that had genuinely changed or allow copy that had not.
 */
import { sha256 } from '@/lib/crypto';

export function contentFingerprint(input: {
  platform: string;
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
}): string {
  return sha256(
    [
      input.platform,
      input.title ?? '',
      input.caption ?? '',
      input.description ?? '',
      (input.hashtags ?? [])
        .map((h) => String(h).replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean)
        .join(','),
    ].join('|')
  );
}
