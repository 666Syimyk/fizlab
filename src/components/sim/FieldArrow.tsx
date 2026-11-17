import { useMemo } from "react";
import * as THREE from "three";

interface FieldArrowProps {
  origin: [number, number, number];
  vector: [number, number, number];
  color: string;
  minLength?: number;
  shaftRadius?: number;
  headLength?: number;
  headRadius?: number;
  opacity?: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Prop-driven (non-imperative) arrow for static field visualizations (grids of
 * many arrows recomputed on parameter change, not animated every frame).
 * For a single continuously-animated vector (velocity/acceleration on a moving
 * body) use `VectorArrow` instead.
 */
export function FieldArrow({ origin, vector, color, minLength = 0.05, shaftRadius = 0.025, headLength = 0.16, headRadius = 0.065, opacity = 1 }: FieldArrowProps) {
  const { quaternion, shaftLen, visible } = useMemo(() => {
    const v = new THREE.Vector3(...vector);
    const length = v.length();
    if (length < minLength) return { quaternion: new THREE.Quaternion(), shaftLen: 0, visible: false };
    const q = new THREE.Quaternion().setFromUnitVectors(UP, v.clone().normalize());
    return { quaternion: q, shaftLen: Math.max(length - headLength, 0.001), visible: true };
  }, [vector, minLength, headLength]);

  if (!visible) return null;

  return (
    <group position={origin} quaternion={quaternion}>
      <mesh position={[0, shaftLen / 2, 0]}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, shaftLen, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, shaftLen + headLength / 2, 0]}>
        <coneGeometry args={[headRadius, headLength, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}
