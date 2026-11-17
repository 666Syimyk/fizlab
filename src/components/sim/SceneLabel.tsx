import type { ReactNode } from "react";
import { Html } from "@react-three/drei";
import { cn } from "@/lib/utils";

interface SceneLabelProps {
  position: [number, number, number];
  children: ReactNode;
  className?: string;
  /** hide the label (e.g. once its object has embedded/vanished) — drei's <Html> does not auto-follow a parent mesh's `visible=false` */
  visible?: boolean;
  /** small coloured dot tying the label to an object/arrow colour */
  tone?: string;
  /** shrink the label with camera distance (off by default so labels stay readable in large scenes) */
  distanceFactor?: number;
}

/**
 * Small billboarded Russian-language tag for a scene object or axis (e.g. "пуля",
 * "брусок", "x, м"). Constant on-screen size so it stays legible however far the
 * camera is; never blocks orbit drag since it occupies only its own tiny footprint.
 */
export function SceneLabel({ position, children, className, visible = true, tone, distanceFactor }: SceneLabelProps) {
  if (!visible) return null;
  return (
    <Html position={position} center distanceFactor={distanceFactor} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
      <span
        className={cn(
          "flex select-none items-center gap-1 whitespace-nowrap rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-white/90 ring-1 ring-white/10 backdrop-blur-[1px]",
          className,
        )}
      >
        {tone && <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: tone }} />}
        {children}
      </span>
    </Html>
  );
}
