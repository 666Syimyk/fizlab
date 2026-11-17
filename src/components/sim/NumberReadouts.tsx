export interface Readout {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}

export function NumberReadouts({ items }: { items: Readout[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border border-border bg-surface-2/60 p-4 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 break-words">
          <div className="text-[11px] uppercase tracking-wide text-muted-2">{it.label}</div>
          <div className="font-mono text-lg font-semibold tabular-nums" style={{ color: it.color ?? "#f4f4f5" }}>
            {it.value}
            {it.unit ? <span className="ml-1 text-xs font-normal text-muted-2">{it.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
