import { useEffect, useRef } from "react";
import { usePrefersReducedMotion, useIsMobile } from "@/hooks/useMediaQuery";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const mobile = useIsMobile();
  const disabled = reducedMotion || mobile;

  useEffect(() => {
    if (disabled) return;
    function handleMove(e: MouseEvent) {
      ref.current?.style.setProperty("--x", `${e.clientX}px`);
      ref.current?.style.setProperty("--y", `${e.clientY}px`);
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [disabled]);

  if (disabled) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 mix-blend-screen"
      style={{
        background:
          "radial-gradient(320px circle at var(--x, 50%) var(--y, 50%), color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 70%)",
      }}
    />
  );
}
