import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

interface PhysicsTickerProps {
  running: boolean;
  speed: number;
  /** called every render frame with the continuous (unstepped) elapsed sim time — use for closed-form/analytic motion */
  onFrame?: (simTime: number, dt: number) => void;
  /** called at a fixed physics timestep — use for numerical integration (RK4, Rapier-adjacent stepping) */
  onFixedStep?: (fixedDt: number, simTime: number) => void;
  fixedDt?: number;
  /** throttled callback for React state (charts, live numbers) */
  onSample?: (simTime: number) => void;
  sampleHz?: number;
  maxSubsteps?: number;
}

/**
 * Non-rendering driver mounted inside <Canvas>. Advances a simulation's time and
 * calls back into imperative (ref-based) updaters every frame for smooth 60fps
 * visuals, plus a throttled sample callback for React-managed UI (graphs, numbers).
 */
export function PhysicsTicker({
  running,
  speed,
  onFrame,
  onFixedStep,
  fixedDt = 1 / 240,
  onSample,
  sampleHz = 20,
  maxSubsteps = 480,
}: PhysicsTickerProps) {
  const acc = useRef(0);
  const sampleAcc = useRef(0);
  const simTime = useRef(0);
  const sampleInterval = 1 / sampleHz;

  useFrame((_, rawDelta) => {
    if (!running) return;
    const dt = Math.min(rawDelta, 1 / 20) * speed;

    if (onFixedStep) {
      acc.current += dt;
      let steps = 0;
      while (acc.current >= fixedDt && steps < maxSubsteps) {
        onFixedStep(fixedDt, simTime.current);
        simTime.current += fixedDt;
        acc.current -= fixedDt;
        steps++;
      }
    } else {
      simTime.current += dt;
    }

    onFrame?.(simTime.current, dt);

    if (onSample) {
      sampleAcc.current += dt;
      if (sampleAcc.current >= sampleInterval) {
        sampleAcc.current = 0;
        onSample(simTime.current);
      }
    }
  });

  return null;
}
