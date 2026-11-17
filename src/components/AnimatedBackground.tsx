import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const NOISE_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>";

export function AnimatedBackground() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div
        className={cn(
          "absolute -left-1/4 -top-1/3 h-[60vw] w-[60vw] rounded-full bg-accent/10 blur-[120px]",
          !reducedMotion && "animate-aurora-1",
        )}
      />
      <div
        className={cn(
          "absolute -bottom-1/3 -right-1/4 h-[55vw] w-[55vw] rounded-full bg-accent-2/10 blur-[120px]",
          !reducedMotion && "animate-aurora-2",
        )}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{ backgroundImage: `url("${NOISE_SVG}")` }}
      />
    </div>
  );
}
