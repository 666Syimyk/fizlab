import type { Scientist } from "@/types/topic";

export function ScientistCard({ scientist }: { scientist: Scientist }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-2/60 shadow-[0_0_0_1px_rgba(124,108,245,0.08)] transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-[0_0_24px_-6px_rgba(124,108,245,0.45)]">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface">
        <img
          src={`/physicists/${scientist.photo}`}
          alt={scientist.name}
          loading="lazy"
          className="h-full w-full object-cover object-top grayscale contrast-125 brightness-90 transition-transform duration-500 group-hover:scale-105"
        />
        <div
          className="pointer-events-none absolute inset-0 mix-blend-color"
          style={{
            background:
              "linear-gradient(160deg, color-mix(in oklab, var(--color-accent) 65%, transparent), color-mix(in oklab, var(--color-accent-2) 55%, transparent))",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(180deg, transparent 55%, rgba(10,10,12,0.55) 100%)" }}
          aria-hidden
        />
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h4 className="font-display text-sm font-semibold leading-tight">{scientist.name}</h4>
        <p className="font-mono text-xs text-muted-2">{scientist.years}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{scientist.achievement}</p>
        <p className="mt-auto pt-3 text-[10px] leading-snug text-muted-2">
          {scientist.author ? `${scientist.author} · ` : ""}
          {scientist.license},{" "}
          <a
            href={scientist.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            Wikimedia Commons
          </a>
        </p>
      </div>
    </div>
  );
}
