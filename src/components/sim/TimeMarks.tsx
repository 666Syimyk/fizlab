import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import * as THREE from "three";

export interface TimeMarksHandle {
  /** drop a mark at a world position */
  add: (x: number, y: number, z: number) => void;
  clear: () => void;
}

interface TimeMarksProps {
  color: string;
  max?: number;
  radius?: number;
}

const dummy = new THREE.Object3D();

/**
 * "Stroboscope" marks: a small disc left on the ground at equal time intervals.
 * Equal spacing = uniform motion, growing spacing = speeding up, shrinking = slowing down.
 */
export const TimeMarks = forwardRef<TimeMarksHandle, TimeMarksProps>(function TimeMarks({ color, max = 160, radius = 0.12 }, ref) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const count = useRef(0);

  const hideAll = () => {
    if (!mesh.current) return;
    dummy.position.set(0, -9999, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    for (let i = 0; i < max; i++) mesh.current.setMatrixAt(i, dummy.matrix);
    mesh.current.instanceMatrix.needsUpdate = true;
    count.current = 0;
  };

  // only on mount: a re-render of the parent must not wipe the marks already dropped
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => hideAll(), []);

  useImperativeHandle(ref, () => ({
    add: (x, y, z) => {
      if (!mesh.current || count.current >= max) return;
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(count.current, dummy.matrix);
      mesh.current.instanceMatrix.needsUpdate = true;
      count.current++;
    },
    clear: hideAll,
  }));

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, max]} frustumCulled={false}>
      <cylinderGeometry args={[radius, radius, 0.02, 18]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} toneMapped={false} />
    </instancedMesh>
  );
});
