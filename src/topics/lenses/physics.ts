/** A null distance represents the focal plane, whose image is at infinity. */
export function imageDistance(focalLength: number, objectDistance: number): number | null {
  if (Math.abs(objectDistance - focalLength) <= 1e-10 * Math.max(1, Math.abs(focalLength))) return null;
  const distance = 1 / (1 / focalLength - 1 / objectDistance);
  return Number.isFinite(distance) ? distance : null;
}
