/**
 * Joint angles (radians) for the `Person` prop. The figure faces +z, its left side is +x.
 * hip/shoulder > 0 swings the limb forward, knee > 0 bends the shin back,
 * elbow > 0 bends the forearm forward, spread > 0 lifts the arm sideways, lean > 0 bends the torso forward.
 */
export interface PoseAngles {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shoulderL: number;
  shoulderR: number;
  elbowL: number;
  elbowR: number;
  spreadL: number;
  spreadR: number;
  lean: number;
}

export const STAND: PoseAngles = {
  hipL: 0,
  hipR: 0,
  kneeL: 0,
  kneeR: 0,
  shoulderL: 0.05,
  shoulderR: 0.05,
  elbowL: 0.15,
  elbowR: 0.15,
  spreadL: 0.08,
  spreadR: 0.08,
  lean: 0,
};

export function pose(overrides: Partial<PoseAngles>): PoseAngles {
  return { ...STAND, ...overrides };
}

/** Running cycle; `phase` in radians grows with the distance run, `intensity` 0..1 (0 = standing). */
export function runPose(phase: number, intensity = 1): PoseAngles {
  const s = Math.sin(phase);
  const k = Math.max(0, Math.min(1, intensity));
  return {
    hipL: 0.75 * s * k,
    hipR: -0.75 * s * k,
    kneeL: (0.25 + 0.9 * Math.max(0, -Math.sin(phase + 0.6))) * k,
    kneeR: (0.25 + 0.9 * Math.max(0, Math.sin(phase + 0.6))) * k,
    shoulderL: -0.7 * s * k + 0.05,
    shoulderR: 0.7 * s * k + 0.05,
    elbowL: 0.15 + 1.25 * k,
    elbowR: 0.15 + 1.25 * k,
    spreadL: 0.08,
    spreadR: 0.08,
    lean: 0.28 * k,
  };
}

/** Walking cycle (smaller swing than running). */
export function walkPose(phase: number): PoseAngles {
  const s = Math.sin(phase);
  return {
    hipL: 0.38 * s,
    hipR: -0.38 * s,
    kneeL: 0.1 + 0.45 * Math.max(0, -Math.sin(phase + 0.5)),
    kneeR: 0.1 + 0.45 * Math.max(0, Math.sin(phase + 0.5)),
    shoulderL: -0.35 * s + 0.05,
    shoulderR: 0.35 * s + 0.05,
    elbowL: 0.3,
    elbowR: 0.3,
    spreadL: 0.08,
    spreadR: 0.08,
    lean: 0.05,
  };
}

/** Both arms pushing straight forward (pushing a cart, a partner, a box). */
export const PUSH = pose({ shoulderL: 1.45, shoulderR: 1.45, elbowL: 0.1, elbowR: 0.1, spreadL: 0.05, spreadR: 0.05, lean: 0.2, hipL: 0.35, kneeL: 0.25, hipR: -0.25, kneeR: 0.1 });

/** Hands raised above the head (basketball shot). */
export const THROW_UP = pose({ shoulderL: 2.7, shoulderR: 2.7, elbowL: 0.5, elbowR: 0.5, spreadL: 0.1, spreadR: 0.1, lean: -0.05 });

/** Sitting (on a swing, a cart, a coaster). */
export const SIT = pose({ hipL: 1.5, hipR: 1.5, kneeL: 1.45, kneeR: 1.45, shoulderL: 0.6, shoulderR: 0.6, elbowL: 0.5, elbowR: 0.5 });

/** Arms out to the sides (figure skater, balance). `t` 0..1 blends from arms-in to arms-out. */
export function spinPose(t: number): PoseAngles {
  const k = Math.max(0, Math.min(1, t));
  return pose({
    spreadL: 0.12 + 1.42 * k,
    spreadR: 0.12 + 1.42 * k,
    shoulderL: 0.25 * (1 - k),
    shoulderR: 0.25 * (1 - k),
    elbowL: 1.9 * (1 - k) + 0.1,
    elbowR: 1.9 * (1 - k) + 0.1,
    hipR: 0.0,
    hipL: 0.0,
  });
}

/** Leaning back and pulling a rope held in both hands in front. */
export const PULL = pose({ shoulderL: 1.1, shoulderR: 1.1, elbowL: 0.35, elbowR: 0.35, lean: -0.22, hipL: 0.3, kneeL: 0.35, hipR: -0.2, kneeR: 0.1 });

/** Kicking leg back, ready to strike (football free kick). */
export const KICK = pose({ hipR: -0.7, kneeR: 1.2, hipL: 0.1, shoulderL: 0.7, shoulderR: -0.4, spreadL: 0.5, spreadR: 0.4, lean: 0.12 });
