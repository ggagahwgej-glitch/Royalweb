import { Crown } from 'lucide-react';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gold-500/30 bg-gradient-to-br from-gold-500/25 to-transparent">
        <Crown size={17} className="text-gold-300" strokeWidth={1.8} />
      </div>
      {!compact ? (
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-[0.16em] text-ink-100">ROYALWEB</div>
          <div className="text-[9.5px] font-medium uppercase tracking-[0.28em] text-gold-500">Autopilot</div>
        </div>
      ) : null}
    </div>
  );
}
