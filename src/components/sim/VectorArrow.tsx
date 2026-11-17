import { forwardRef, useImperativeHandle, useRef } from "react";
import * as THREE from "three";

export interface VectorArrowHandle {
  /** position the arrow: origin in world space, vector already scaled for display length */
  set: (origin: THREE.Vector3Tuple, vector: THREE.Vector3Tuple) => void;
  hide: () => void;
}

interface VectorArrowProps {
  color: string;
  minLength?: number;
  shaftRadius?: number;
  headLength?: number;
  headRadius?: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Imperative arrow (cylinder shaft + cone head) for velocity/acceleration vectors.
 * Updated via `ref.current.set(origin, vector)` inside a parent's useFrame — no
 * React re-render on every animation frame.
 */
export const VectorArrow = forwardRef<VectorArrowHandle, VectorArrowProps>(function VectorArrow(
  { color, minLength = 0.08, shaftRadius = 0.035, headLength = 0.22, headRadius = 0.09 },
  ref,
) {
  const group = useRef<THREE.Group>(null!);
  const shaft = useRef<THREE.Mesh>(null!);
  const head = useRef<THREE.Mesh>(null!);
  const quat = useRef(new THREE.Quaternion());
  const dir = useRef(new THREE.Vector3());
  const originVec = useRef(new THREE.Vector3());

  useImperativeHandle(ref, () => ({
    set: (origin, vector) => {
      if (!group.current) return;
      dir.current.set(vector[0], vector[1], vector[2]);
      const length = dir.current.length();
      if (length < minLength) {
        group.current.visible = false;
        return;
      }
      group.current.visible = true;
      originVec.current.set(origin[0], origin[1], origin[2]);
      group.current.position.copy(originVec.current);
      quat.current.setFromUnitVectors(UP, dir.current.clone().normalize());
      group.current.quaternion.copy(quat.current);

      const shaftLen = Math.max(length - headLength, 0.001);
      shaft.current.scale.set(1, shaftLen, 1);
      shaft.current.position.set(0, shaftLen / 2, 0);
      head.current.position.set(0, shaftLen + headLength / 2, 0);
    },
    hide: () => {
      if (group.current) group.current.visible = false;
    },
  }));

  return (
    <group ref={group} visible={false}>
      <mesh ref={shaft}>
        <cylinderGeometry args={[shaftRadius, shaftRadius, 1, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh ref={head}>
        <coneGeometry args={[headRadius, headLength, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} roughness={0.3} metalness={0.1} />
      </mesh>
    </group>
  );
});
