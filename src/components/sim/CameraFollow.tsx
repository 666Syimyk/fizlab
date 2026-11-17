import { useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface OrbitLike {
  target: THREE.Vector3;
}

interface CameraFollowProps {
  /** object whose position the camera tracks */
  target: RefObject<THREE.Object3D | null>;
  /** axis to follow: a car drives along x, an elevator rides along y */
  axis?: "x" | "y";
  /** where the orbit target sits relative to the object (look a bit ahead of a car, etc.) */
  lead?: number;
  /** clamp the followed coordinate so the camera never leaves the built scenery */
  min?: number;
  max?: number;
}

/**
 * Keeps a moving object (car, runner, elevator) in frame by sliding the camera and its
 * orbit target together along one axis — the user can still rotate/zoom freely around it.
 * Needs <OrbitControls makeDefault> (SceneCanvas provides it).
 */
export function CameraFollow({ target, axis = "x", lead = 0, min = -Infinity, max = Infinity }: CameraFollowProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const fallback = useRef<number | null>(null);
  useFrame(() => {
    const obj = target.current;
    if (!obj) return;
    const desired = THREE.MathUtils.clamp(obj.position[axis], min, max) + lead;
    if (controls?.target) {
      const delta = desired - controls.target[axis];
      if (Math.abs(delta) < 1e-6) return;
      controls.target[axis] += delta;
      camera.position[axis] += delta;
    } else {
      if (fallback.current === null) fallback.current = desired;
      const delta = desired - fallback.current;
      fallback.current = desired;
      camera.position[axis] += delta;
    }
  });
  return null;
}
