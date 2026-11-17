import { forwardRef, useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";

interface SpringCoilProps {
  color: string;
  loops?: number;
  radius?: number;
  segments?: number;
  position?: [number, number, number];
}

/**
 * Unit-length coil (local x: 0..1). Stretch/compress by imperatively setting
 * `group.scale.x` on the forwarded ref each frame — geometry itself is static.
 */
export const SpringCoil = forwardRef<THREE.Group, SpringCoilProps>(function SpringCoil(
  { color, loops = 9, radius = 0.16, segments = 140, position },
  ref,
) {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.06, 0, 0)];
    for (let i = 0; i <= segments; i++) {
      const t = 0.06 + (i / segments) * 0.88;
      const phase = (i / segments) * Math.PI * 2 * loops;
      pts.push(new THREE.Vector3(t, radius * Math.sin(phase), radius * Math.cos(phase)));
    }
    pts.push(new THREE.Vector3(0.94, 0, 0), new THREE.Vector3(1, 0, 0));
    return pts;
  }, [loops, radius, segments]);

  return (
    <group ref={ref} position={position}>
      <Line points={points} color={color} lineWidth={2.5} />
    </group>
  );
});
