import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { STAND, type PoseAngles } from "./pose";

type GroupProps = Omit<ThreeElements["group"], "ref">;

export interface PersonProps extends GroupProps {
  shirt?: string;
  pants?: string;
  skin?: string;
  hair?: string;
  shoes?: string;
  /** static pose */
  pose?: PoseAngles;
  /** live pose, read every frame (mutate `.current` from a parent's frame loop) */
  poseRef?: RefObject<PoseAngles>;
  skates?: boolean;
  /** long hair / ponytail silhouette */
  longHair?: boolean;
  cap?: string;
}

/**
 * Low-poly articulated human, ~1.75 m tall at scale 1, feet at y = 0, facing +z
 * (rotate y by +π/2 to face +x). Built from primitives so it costs a few dozen
 * triangles per limb and needs no model files.
 */
export const Person = forwardRef<THREE.Group, PersonProps>(function Person(
  { shirt = "#3b82f6", pants = "#1f2937", skin = "#e8b48a", hair = "#3b2416", shoes = "#18181b", pose, poseRef, skates = false, longHair = false, cap, ...group },
  ref,
) {
  const root = useRef<THREE.Group>(null!);
  const upper = useRef<THREE.Group>(null!);
  const hipL = useRef<THREE.Group>(null!);
  const hipR = useRef<THREE.Group>(null!);
  const kneeL = useRef<THREE.Group>(null!);
  const kneeR = useRef<THREE.Group>(null!);
  const shL = useRef<THREE.Group>(null!);
  const shR = useRef<THREE.Group>(null!);
  const elL = useRef<THREE.Group>(null!);
  const elR = useRef<THREE.Group>(null!);
  useImperativeHandle(ref, () => root.current);

  const apply = (p: PoseAngles) => {
    if (!upper.current) return;
    upper.current.rotation.x = p.lean;
    hipL.current.rotation.x = -p.hipL;
    hipR.current.rotation.x = -p.hipR;
    kneeL.current.rotation.x = p.kneeL;
    kneeR.current.rotation.x = p.kneeR;
    shL.current.rotation.set(-p.shoulderL, 0, p.spreadL);
    shR.current.rotation.set(-p.shoulderR, 0, -p.spreadR);
    elL.current.rotation.x = -p.elbowL;
    elR.current.rotation.x = -p.elbowR;
  };

  useLayoutEffect(() => {
    apply(pose ?? STAND);
  });

  useFrame(() => {
    if (poseRef?.current) apply(poseRef.current);
  });

  const cloth = (color: string) => <meshStandardMaterial color={color} roughness={0.75} metalness={0.05} />;
  const skinMat = <meshStandardMaterial color={skin} roughness={0.6} />;

  const leg = (side: 1 | -1, hipRef: RefObject<THREE.Group>, kneeRef: RefObject<THREE.Group>) => (
    <group ref={hipRef} position={[0.1 * side, 0.93, 0]}>
      <mesh position={[0, -0.22, 0]} castShadow>
        <capsuleGeometry args={[0.078, 0.3, 4, 10]} />
        {cloth(pants)}
      </mesh>
      <group ref={kneeRef} position={[0, -0.44, 0]}>
        <mesh position={[0, -0.215, 0]} castShadow>
          <capsuleGeometry args={[0.062, 0.31, 4, 10]} />
          {cloth(pants)}
        </mesh>
        <group position={[0, -0.43, 0]}>
          <mesh position={[0, -0.025, 0.045]} castShadow>
            <boxGeometry args={[0.105, skates ? 0.11 : 0.07, 0.25]} />
            {cloth(skates ? "#f4f4f5" : shoes)}
          </mesh>
          {skates && (
            <mesh position={[0, -0.095, 0.05]}>
              <boxGeometry args={[0.015, 0.035, 0.32]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );

  const arm = (side: 1 | -1, shoulderRef: RefObject<THREE.Group>, elbowRef: RefObject<THREE.Group>) => (
    <group ref={shoulderRef} position={[0.215 * side, 1.42, 0]}>
      <mesh position={[0, -0.15, 0]} castShadow>
        <capsuleGeometry args={[0.056, 0.2, 4, 10]} />
        {cloth(shirt)}
      </mesh>
      <group ref={elbowRef} position={[0, -0.3, 0]}>
        <mesh position={[0, -0.13, 0]} castShadow>
          <capsuleGeometry args={[0.047, 0.18, 4, 10]} />
          {skinMat}
        </mesh>
        <mesh position={[0, -0.285, 0]} castShadow>
          <sphereGeometry args={[0.05, 10, 10]} />
          {skinMat}
        </mesh>
      </group>
    </group>
  );

  return (
    <group ref={root} {...group}>
      {leg(1, hipL, kneeL)}
      {leg(-1, hipR, kneeR)}
      <group ref={upper} position={[0, 0.95, 0]}>
        <group position={[0, -0.95, 0]}>
          <mesh position={[0, 0.96, 0]} castShadow>
            <boxGeometry args={[0.32, 0.16, 0.2]} />
            {cloth(pants)}
          </mesh>
          <mesh position={[0, 1.23, 0]} scale={[1, 1, 0.68]} castShadow>
            <capsuleGeometry args={[0.165, 0.24, 6, 14]} />
            {cloth(shirt)}
          </mesh>
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.048, 0.055, 0.1, 10]} />
            {skinMat}
          </mesh>
          <mesh position={[0, 1.635, 0]} castShadow>
            <sphereGeometry args={[0.115, 18, 16]} />
            {skinMat}
          </mesh>
          {/* eyes show which way the person faces */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.04 * s, 1.65, 0.103]}>
              <sphereGeometry args={[0.014, 8, 8]} />
              <meshStandardMaterial color="#111" roughness={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 1.66, -0.012]} rotation={[-0.35, 0, 0]}>
            <sphereGeometry args={[0.122, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={cap ?? hair} roughness={0.8} />
          </mesh>
          {cap && (
            <mesh position={[0, 1.7, 0.1]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.2, 0.015, 0.12]} />
              <meshStandardMaterial color={cap} roughness={0.8} />
            </mesh>
          )}
          {longHair && (
            <mesh position={[0, 1.52, -0.1]} castShadow>
              <capsuleGeometry args={[0.06, 0.16, 4, 8]} />
              <meshStandardMaterial color={hair} roughness={0.8} />
            </mesh>
          )}
          {arm(1, shL, elL)}
          {arm(-1, shR, elR)}
        </group>
      </group>
    </group>
  );
});

/** World position of a person's right hand for a given pose is hard to compute analytically — scenes place held objects by hand. */
export const PERSON_HEIGHT = 1.75;
export const PERSON_SHOULDER_Y = 1.42;
export const PERSON_UPPER_ARM = 0.3;
export const PERSON_FOREARM = 0.285;
