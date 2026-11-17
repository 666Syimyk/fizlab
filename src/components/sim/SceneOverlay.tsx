import type { ReactNode } from "react";

export interface LegendItem {
  color: string;
  label: string;
  /** glyph drawn before the label */
  kind?: "arrow" | "dot" | "line" | "dash" | "square";
}

function Glyph({ kind = "arrow", color }: { kind?: LegendItem["kind"]; color: string }) {
  if (kind === "arrow") {
    return (
      <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true" className="shrink-0">
        <path d="M1 5h11" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M10.5 1.2 17 5l-6.5 3.8z" fill={color} />
      </svg>
    );
  }
  if (kind === "dot") return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />;
  if (kind === "line") return <span aria-hidden="true" className="inline-block h-[3px] w-4 shrink-0 rounded" style={{ background: color }} />;
  if (kind === "dash") return <span aria-hidden="true" className="inline-block w-4 shrink-0 border-t-2 border-dashed" style={{ borderColor: color }} />;
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />;
}

/** "What the colours mean" chips in the top-left corner of the 3D scene. */
export function SceneLegend({ items }: { items: LegendItem[] }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Обозначения на сцене" className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[calc(100%-3.75rem)] flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium leading-none text-white/90 ring-1 ring-white/10 backdrop-blur-sm">
          <Glyph kind={item.kind} color={item.color} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Subtitle at the bottom of the scene: what is happening right now, in plain words. */
export function SceneCaption({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center">
      <p className="max-w-[46rem] rounded-lg bg-black/72 px-3 py-2 text-center text-[12.5px] leading-snug text-white/95 ring-1 ring-white/10 backdrop-blur-sm sm:text-[13px]">
        {children}
      </p>
    </div>
  );
}
