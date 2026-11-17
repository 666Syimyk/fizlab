interface EnergyBarsProps {
  label: string;
  kinetic: number;
  potential: number;
  total: number;
  unit?: string;
}

export function EnergyBars({ label, kinetic, potential, total, unit = "Дж" }: EnergyBarsProps) {
  const safeTotal = total > 1e-9 ? total : 1;
  const kPct = Math.max(0, Math.min(100, (kinetic / safeTotal) * 100));
  const pPct = Math.max(0, Math.min(100, (potential / safeTotal) * 100));

  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-4">
      <p className="mb-3 text-xs font-medium text-muted-2">{label}</p>
      <div className="flex h-36 items-end justify-center gap-8">
        <div className="flex h-full w-16 flex-col items-center gap-1.5">
          <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-t-md bg-surface">
            <div
              className="w-full rounded-t-md bg-[#4ade80] shadow-[0_0_12px_-2px_#4ade80] transition-[height] duration-150 ease-linear"
              style={{ height: `${kPct}%` }}
            />
          </div>
          <span className="text-center font-mono text-[11px] tabular-nums text-muted-2">
            E<sub>к</sub> {kinetic.toFixed(2)} {unit}
          </span>
        </div>
        <div className="flex h-full w-16 flex-col items-center gap-1.5">
          <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-t-md bg-surface">
            <div
              className="w-full rounded-t-md bg-[#f87171] shadow-[0_0_12px_-2px_#f87171] transition-[height] duration-150 ease-linear"
              style={{ height: `${pPct}%` }}
            />
          </div>
          <span className="text-center font-mono text-[11px] tabular-nums text-muted-2">
            E<sub>п</sub> {potential.toFixed(2)} {unit}
          </span>
        </div>
      </div>
    </div>
  );
}
