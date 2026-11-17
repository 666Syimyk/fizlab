import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Leva } from "leva";
import { Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { SceneCaption, SceneLegend, type LegendItem } from "./SceneOverlay";

interface SimShellProps {
  scene: ReactNode;
  controls: ReactNode;
  numbers?: ReactNode;
  graphs?: ReactNode;
  note?: ReactNode;
  sceneHeightClassName?: string;
  /** what the arrows / colours in the scene mean */
  legend?: LegendItem[];
  /** live subtitle: what is happening in the scene right now */
  caption?: ReactNode;
}

const LEVA_THEME = {
  colors: { elevation1: "#101013", elevation2: "#17171b", elevation3: "#232328", accent1: "#6957df", accent2: "#7c6cf5", accent3: "#9b8afb", highlight1: "#a1a1aa", highlight2: "#d4d4d8", highlight3: "#f4f4f5" },
};

/** Round icon button drawn over the 3D scene. */
function SceneButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white/90 ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        pressed && "bg-accent-strong/85 text-white hover:bg-accent-strong",
      )}
    >
      {children}
    </button>
  );
}

export function SimShell({ scene, controls, numbers, graphs, note, sceneHeightClassName, legend, caption }: SimShellProps) {
  const mobile = useIsMobile();
  const [controlsOpen, setControlsOpen] = useState(!mobile);
  // parameters panel floating over the scene in fullscreen
  const [fullParamsOpen, setFullParamsOpen] = useState(!mobile);
  const controlsId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(stage);
  useEffect(() => {
    setControlsOpen(!mobile);
    setFullParamsOpen(!mobile);
  }, [mobile]);

  // Leva is mounted in one place at a time; its values live in the store either way
  const levaPanel = <Leva fill flat titleBar={false} theme={LEVA_THEME} />;
  const full = fullscreen.active;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        <div ref={stage} className={cn(full && "flex h-full w-full flex-col gap-2 bg-background p-2 sm:p-3", fullscreen.pinned && "fixed inset-0 z-[1000]")}>
          <div className={cn("relative", full ? "min-h-0 flex-1" : (sceneHeightClassName ?? "h-[400px] sm:h-[460px] lg:h-[540px]"))}>
            {scene}
            {legend && <SceneLegend items={legend} />}
            {caption && <SceneCaption>{caption}</SceneCaption>}
            <div className="absolute right-2 top-2 z-30 flex flex-col gap-1.5">
              <SceneButton label={full ? "Выйти из полноэкранного режима" : "На весь экран"} onClick={fullscreen.toggle}>
                {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </SceneButton>
              {full && (
                <SceneButton label={fullParamsOpen ? "Скрыть параметры" : "Показать параметры"} pressed={fullParamsOpen} onClick={() => setFullParamsOpen((open) => !open)}>
                  <SlidersHorizontal className="h-4 w-4" />
                </SceneButton>
              )}
            </div>
            {full && fullParamsOpen && (
              <div className="absolute right-[3.25rem] top-2 z-30 max-h-[calc(100%-7rem)] w-[min(320px,calc(100%-4rem))] overflow-y-auto rounded-xl border border-border bg-surface-2/95 shadow-xl backdrop-blur-sm">
                {levaPanel}
              </div>
            )}
          </div>
          {full && controls}
        </div>
        {!full && controls}
        {note && <div className="text-xs leading-relaxed text-muted-2">{note}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-2/60">
          <button
            type="button"
            aria-expanded={controlsOpen}
            aria-controls={controlsId}
            onClick={() => setControlsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground"
          >
            Параметры симуляции
            <span aria-hidden="true">{controlsOpen ? "−" : "+"}</span>
          </button>
          <div id={controlsId} hidden={!controlsOpen}>
            {full ? <p className="px-4 pb-3 text-xs text-muted-2">Параметры открыты поверх сцены в полноэкранном режиме.</p> : levaPanel}
          </div>
        </div>
        {numbers}
        {graphs}
      </div>
    </div>
  );
}
