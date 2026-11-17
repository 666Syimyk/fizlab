import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import type { GasParticle } from "@/lib/particleGas";

export interface ParticleInstancesHandle {
  sync: (particles: GasParticle[], y: number, colorFn?: (p: GasParticle, i: number) => THREE.Color | string | undefined) => void;
}

interface ParticleInstancesProps {
  count: number;
  color: string;
  radius?: number;
  emissiveIntensity?: number;
}

const dummy = new THREE.Object3D();

export const ParticleInstances = forwardRef<ParticleInstancesHandle, ParticleInstancesProps>(function ParticleInstances(
  { count, color, radius = 0.09, emissiveIntensity = 0.7 },
  ref,
) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useImperativeHandle(ref, () => ({
    sync: (particles, y, colorFn) => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const n = Math.min(particles.length, count);
      for (let i = 0; i < n; i++) {
        const p = particles[i];
        dummy.position.set(p.x, y, p.z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (colorFn) {
          const c = colorFn(p, i);
          if (c !== undefined) {
            mesh.setColorAt(i, typeof c === "string" ? colorObj.set(c) : c);
          }
        }
      }
      // hide unused instances far away
      for (let i = n; i < count; i++) {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  }));

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[radius, 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.35} metalness={0.2} />
    </instancedMesh>
  );
});
