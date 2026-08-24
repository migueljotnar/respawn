import { Plus, RefreshCcw } from "lucide-react";

interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className="flex items-center gap-3" aria-label="Respawn">
      <span
        className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-respawn-neon/30 bg-respawn-base shadow-neon-soft"
        aria-hidden="true"
      >
        <RefreshCcw className="h-7 w-7 text-respawn-neon" strokeWidth={2.4} />
        <Plus
          className="absolute h-3.5 w-3.5 text-respawn-purple"
          strokeWidth={3.2}
        />
      </span>
      <span className={compact ? "sr-only" : "font-display text-xl tracking-digital text-respawn-ice"}>
        RESPAWN
      </span>
    </div>
  );
}
