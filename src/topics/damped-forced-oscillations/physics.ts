/** No finite steady-state amplitude exists at exact resonance without damping. */
export function steadyStateAmplitude(force: number, mass: number, naturalFrequency: number, damping: number, driveFrequency: number): number | null {
  const denominator = Math.hypot(naturalFrequency ** 2 - driveFrequency ** 2, 2 * damping * driveFrequency);
  return denominator <= 1e-9 ? null : force / mass / denominator;
}

/** Solution of m x'' + m ω² x = F cos(ωt), with x(0) = x'(0) = 0. */
export function undampedResonance(force: number, mass: number, frequency: number, time: number) {
  const envelope = force * time / (2 * mass * frequency);
  return { x: envelope * Math.sin(frequency * time), envelope };
}
