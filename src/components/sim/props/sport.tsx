import { forwardRef } from "react";
import type { ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { basketballTexture, billiardTexture, soccerTexture } from "./textures";

type MeshProps = Omit<ThreeElements["mesh"], "ref">;
type GroupProps = Omit<ThreeElements["group"], "ref">;

interface BallProps extends MeshProps {
  radius?: number;
}

/** Basketball — real radius 0.12 m. */
export const Basketball = forwardRef<THREE.Mesh, BallProps>(function Basketball({ radius = 0.12, ...mesh }, ref) {
  return (
    <mesh ref={ref} castShadow {...mesh}>
      <sphereGeometry args={[radius, 36, 24]} />
      <meshStandardMaterial map={basketballTexture()} roughness={0.78} />
    </mesh>
  );
});

/** Football (soccer ball) — real radius 0.11 m. */
export const SoccerBall = forwardRef<THREE.Mesh, BallProps>(function SoccerBall({ radius = 0.11, ...mesh }, ref) {
  return (
    <mesh ref={ref} castShadow {...mesh}>
      <sphereGeometry args={[radius, 36, 24]} />
      <meshStandardMaterial map={soccerTexture()} roughness={0.55} />
    </mesh>
  );
});

/** Billiard ball with a number (0 = white cue ball) — real radius 0.0286 m. */
export const BilliardBall = forwardRef<THREE.Mesh, BallProps & { num?: number }>(function BilliardBall({ radius = 0.0286, num = 0, ...mesh }, ref) {
  return (
    <mesh ref={ref} castShadow {...mesh}>
      <sphereGeometry args={[radius, 32, 22]} />
      <meshStandardMaterial map={billiardTexture(num)} roughness={0.15} metalness={0.05} />
    </mesh>
  );
});

/** Polished steel ball (Newton's cradle, bearings). */
export const SteelBall = forwardRef<THREE.Mesh, BallProps>(function SteelBall({ radius = 0.1, ...mesh }, ref) {
  return (
    <mesh ref={ref} castShadow {...mesh}>
      <sphereGeometry args={[radius, 32, 24]} />
      <meshStandardMaterial color="#d9dde3" metalness={1} roughness={0.12} />
    </mesh>
  );
});

/** Cast-iron cannonball. */
export const Cannonball = forwardRef<THREE.Mesh, BallProps>(function Cannonball({ radius = 0.1, ...mesh }, ref) {
  return (
    <mesh ref={ref} castShadow {...mesh}>
      <sphereGeometry args={[radius, 28, 20]} />
      <meshStandardMaterial color="#2c2c30" metalness={0.75} roughness={0.42} />
    </mesh>
  );
});

/**
 * Basketball hoop with the rim centre at the group's origin. Side-view scenes have the
 * shooter at −x, so the backboard, arm and pole stand behind the rim on the +x side.
 */
export function BasketballHoop({ rimRadius = 0.23, ...group }: GroupProps & { rimRadius?: number }) {
  return (
    <group {...group}>
      {/* rim */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[rimRadius, 0.018, 8, 32]} />
        <meshStandardMaterial color="#f26b1d" emissive="#f26b1d" emissiveIntensity={0.25} metalness={0.4} roughness={0.4} />
      </mesh>
      {/* net */}
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[rimRadius, rimRadius * 0.62, 0.4, 14, 3, true]} />
        <meshBasicMaterial color="#f4f4f5" wireframe transparent opacity={0.85} />
      </mesh>
      {/* bracket + backboard */}
      <mesh position={[rimRadius + 0.08, 0, 0]}>
        <boxGeometry args={[0.16, 0.04, 0.12]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[rimRadius + 0.17, 0.42, 0]}>
        <boxGeometry args={[0.04, 1.05, 1.8]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.35} transparent opacity={0.92} />
      </mesh>
      <mesh position={[rimRadius + 0.145, 0.3, 0]}>
        <boxGeometry args={[0.01, 0.45, 0.59]} />
        <meshStandardMaterial color="#dc2626" roughness={0.5} />
      </mesh>
      <mesh position={[rimRadius + 0.14, 0.3, 0]}>
        <boxGeometry args={[0.012, 0.37, 0.51]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      {/* pole */}
      <mesh position={[rimRadius + 1.1, 0.45, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[1.8, 0.1, 0.1]} />
        <meshStandardMaterial color="#374151" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[rimRadius + 1.95, -1.3, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.11, 3.6, 14]} />
        <meshStandardMaterial color="#374151" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[rimRadius + 1.95, -3.05 + 0.1, 0]}>
        <boxGeometry args={[1.2, 0.2, 1.0]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} />
      </mesh>
    </group>
  );
}

/** Football goal 7.32 × 2.44 m seen from the side: origin on the goal line at ground level, net toward +x. */
export function FootballGoal({ width = 7.32, height = 2.44, ...group }: GroupProps & { width?: number; height?: number }) {
  const post = <meshStandardMaterial color="#f8fafc" roughness={0.35} />;
  const depth = 1.8;
  return (
    <group {...group}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, height / 2, (s * width) / 2]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, height, 12]} />
          {post}
        </mesh>
      ))}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, width + 0.12, 12]} />
        {post}
      </mesh>
      {/* net box */}
      <mesh position={[depth / 2, height / 2, 0]}>
        <boxGeometry args={[depth, height, width, 6, 8, 18]} />
        <meshBasicMaterial color="#e5e7eb" wireframe transparent opacity={0.35} />
      </mesh>
    </group>
  );
}
