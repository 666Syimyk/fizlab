import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { HeroScene } from "./HeroScene";

interface HeroCanvasProps {
  reducedMotion: boolean;
  mobile: boolean;
  active: boolean;
}

/**
 * Isolates the three.js/@react-three/fiber dependency (the "three" manual
 * chunk, ~340KB gzipped) into its own module so it can be loaded via
 * React.lazy from Hero.tsx — keeping it out of the home page's critical
 * first-paint path.
 */
export function HeroCanvas({ reducedMotion, mobile, active }: HeroCanvasProps) {
  return (
    <Canvas
      fallback={<div aria-hidden="true" className="h-full w-full bg-surface" />}
      frameloop={reducedMotion || !active ? "demand" : "always"}
      dpr={mobile ? [1, 1.25] : [1, 2]}
      camera={{ position: [0, 1.4, 7.5], fov: 50 }}
      gl={{ antialias: !mobile }}
    >
      <Suspense fallback={null}>
        <HeroScene reducedMotion={reducedMotion} mobile={mobile} />
      </Suspense>
    </Canvas>
  );
}
