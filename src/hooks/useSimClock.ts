import { useCallback, useState } from "react";

export interface SimClock {
  running: boolean;
  speed: number;
  /** increments on every reset; use as a React `key` to force remount of physics state */
  resetNonce: number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  reset: () => void;
}

/**
 * Play/pause/speed/reset state for a simulation. Physics stepping itself lives
 * inside the R3F canvas (see PhysicsTicker) — this hook only owns the transport state.
 */
export function useSimClock(initialSpeed = 1, autoplay = true): SimClock {
  const [running, setRunning] = useState(autoplay);
  const [speed, setSpeed] = useState(initialSpeed);
  const [resetNonce, setResetNonce] = useState(0);

  const toggle = useCallback(() => setRunning((r) => !r), []);
  const play = useCallback(() => setRunning(true), []);
  const pause = useCallback(() => setRunning(false), []);
  const reset = useCallback(() => setResetNonce((n) => n + 1), []);

  return { running, speed, resetNonce, toggle, play, pause, setSpeed, reset };
}
