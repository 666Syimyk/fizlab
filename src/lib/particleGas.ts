// Shared 2D (x,z-plane) elastic-particle-gas physics, reused by kinetic-theory,
// entropy, diffusion and phase-transition simulations. Deliberately NOT a
// generic physics engine: plain wall-bounce + optional pairwise elastic
// collisions, integrated with simple fixed-step Euler (positions only move
// ballistically between wall/particle contacts, so Euler is exact here).

export interface GasParticle {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export function initParticles(n: number, bounds: Bounds, speed: number, radius = 0.09): GasParticle[] {
  const particles: GasParticle[] = [];
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x: bounds.xMin + radius + Math.random() * (bounds.xMax - bounds.xMin - 2 * radius),
      z: bounds.zMin + radius + Math.random() * (bounds.zMax - bounds.zMin - 2 * radius),
      vx: Math.cos(angle) * speed,
      vz: Math.sin(angle) * speed,
      r: radius,
    });
  }
  return particles;
}

/** Optional vertical dividing wall at x=dividerX, with a gap opening [gapMin,gapMax] in z (or fully solid if no gap). */
export interface Divider {
  x: number;
  gapMin?: number;
  gapMax?: number;
}

/** Returns total wall-impulse magnitude (Σ|Δp|) accumulated this step, useful for measuring pressure. */
export function stepParticles(
  particles: GasParticle[],
  dt: number,
  bounds: Bounds,
  opts: { pairwise?: boolean; divider?: Divider | null } = {},
): number {
  const n = particles.length;
  let wallImpulse = 0;
  for (let i = 0; i < n; i++) {
    const p = particles[i];
    const nextX = p.x + p.vx * dt;

    if (opts.divider) {
      const d = opts.divider;
      const crossing = (p.x - d.x) * (nextX - d.x) < 0;
      const inGap = d.gapMin !== undefined && d.gapMax !== undefined && p.z > d.gapMin && p.z < d.gapMax;
      if (crossing && !inGap) {
        p.vx = -p.vx;
      }
    }

    p.x += p.vx * dt;
    p.z += p.vz * dt;

    if (p.x - p.r < bounds.xMin) {
      p.x = bounds.xMin + p.r;
      wallImpulse += 2 * Math.abs(p.vx);
      p.vx = Math.abs(p.vx);
    } else if (p.x + p.r > bounds.xMax) {
      p.x = bounds.xMax - p.r;
      wallImpulse += 2 * Math.abs(p.vx);
      p.vx = -Math.abs(p.vx);
    }
    if (p.z - p.r < bounds.zMin) {
      p.z = bounds.zMin + p.r;
      wallImpulse += 2 * Math.abs(p.vz);
      p.vz = Math.abs(p.vz);
    } else if (p.z + p.r > bounds.zMax) {
      p.z = bounds.zMax - p.r;
      wallImpulse += 2 * Math.abs(p.vz);
      p.vz = -Math.abs(p.vz);
    }
  }

  if (opts.pairwise) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minDist = a.r + b.r;
        if (dist > 0 && dist < minDist) {
          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = minDist - dist;
          a.x -= (nx * overlap) / 2;
          a.z -= (nz * overlap) / 2;
          b.x += (nx * overlap) / 2;
          b.z += (nz * overlap) / 2;

          const relVx = b.vx - a.vx;
          const relVz = b.vz - a.vz;
          const rel = relVx * nx + relVz * nz;
          if (rel < 0) {
            a.vx += rel * nx;
            a.vz += rel * nz;
            b.vx -= rel * nx;
            b.vz -= rel * nz;
          }
        }
      }
    }
  }
  return wallImpulse;
}

export function meanSpeed(particles: GasParticle[]): number {
  let sum = 0;
  for (const p of particles) sum += Math.hypot(p.vx, p.vz);
  return particles.length ? sum / particles.length : 0;
}

export function rmsSpeed(particles: GasParticle[]): number {
  let sum = 0;
  for (const p of particles) sum += p.vx * p.vx + p.vz * p.vz;
  return particles.length ? Math.sqrt(sum / particles.length) : 0;
}
