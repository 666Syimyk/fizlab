import { Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface TransportControlsProps {
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  speedOptions?: number[];
  extra?: React.ReactNode;
}

const DEFAULT_SPEEDS = [0.1, 0.25, 0.5, 1, 1.5, 2];

export function TransportControls({
  running,
  onToggle,
  onReset,
  speed,
  onSpeedChange,
  speedOptions = DEFAULT_SPEEDS,
  extra,
}: TransportControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3">
      <button
        type="button"
        onClick={onToggle}
        aria-label={running ? "Пауза" : "Пуск"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-strong text-accent-foreground transition hover:bg-accent-strong/90"
      >
        {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label="Сбросить"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-accent/40 hover:text-foreground"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-2">Скорость</span>
        {speedOptions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeedChange(s)}
            aria-pressed={speed === s}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-xs tabular-nums transition",
              speed === s ? "bg-accent/20 text-accent" : "text-muted-2 hover:text-foreground",
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
    </div>
  );
}
