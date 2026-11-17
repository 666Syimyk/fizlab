import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { latheProfile } from "./shared";
import { textTexture, woodTexture } from "./textures";

type GroupProps = Omit<ThreeElements["group"], "ref">;

const UP = new THREE.Vector3(0, 1, 0);

/* ---------------- rods, ropes, strings ---------------- */

export interface RodHandle {
  set: (from: THREE.Vector3Tuple, to: THREE.Vector3Tuple) => void;
  hide: () => void;
}

/** Imperative cylinder between two points — ropes, strings, cables, rods. */
export const Rod = forwardRef<RodHandle, { radius?: number; color?: string; metal?: boolean; from?: THREE.Vector3Tuple; to?: THREE.Vector3Tuple }>(function Rod(
  { radius = 0.012, color = "#c8b48a", metal = false, from, to },
  ref,
) {
  const mesh = useRef<THREE.Mesh>(null!);
  const a = useRef(new THREE.Vector3());
  const b = useRef(new THREE.Vector3());
  const set = (f: THREE.Vector3Tuple, t: THREE.Vector3Tuple) => {
    if (!mesh.current) return;
    a.current.set(...f);
    b.current.set(...t);
    const dir = b.current.clone().sub(a.current);
    const len = dir.length();
    if (len < 1e-5) {
      mesh.current.visible = false;
      return;
    }
    mesh.current.visible = true;
    mesh.current.position.copy(a.current).add(b.current).multiplyScalar(0.5);
    mesh.current.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.current.scale.set(1, len, 1);
  };
  useImperativeHandle(ref, () => ({ set, hide: () => mesh.current && (mesh.current.visible = false) }));
  useEffect(() => {
    if (from && to) set(from, to);
  });
  return (
    <mesh ref={mesh} castShadow>
      <cylinderGeometry args={[radius, radius, 1, 8]} />
      <meshStandardMaterial color={color} metalness={metal ? 0.85 : 0.05} roughness={metal ? 0.3 : 0.85} />
    </mesh>
  );
});

/* ---------------- cannon ---------------- */

/** distance from the trunnion pivot to the muzzle (scale 1) */
export const CANNON_MUZZLE = 1.2;
/** height of the trunnion pivot above the ground (scale 1) */
export const CANNON_PIVOT_Y = 0.78;

function SpokedWheel({ radius, z, spinRef }: { radius: number; z: number; spinRef?: RefObject<number> }) {
  const spin = useRef<THREE.Group>(null!);
  useFrame(() => {
    if (spinRef && spin.current) spin.current.rotation.z = -(spinRef.current ?? 0);
  });
  const wood = woodTexture("dark", 2);
  return (
    <group position={[0, radius, z]}>
      <group ref={spin}>
        <mesh castShadow>
          <torusGeometry args={[radius - 0.03, 0.045, 8, 32]} />
          <meshStandardMaterial map={wood} roughness={0.8} />
        </mesh>
        <mesh>
          <torusGeometry args={[radius, 0.022, 6, 32]} />
          <meshStandardMaterial color="#26262a" metalness={0.8} roughness={0.4} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.18, 14]} />
          <meshStandardMaterial map={wood} roughness={0.8} />
        </mesh>
        {Array.from({ length: 10 }, (_, i) => {
          const ang = (i / 10) * Math.PI * 2;
          const mid = (radius + 0.06) / 2;
          return (
            <mesh key={i} position={[Math.cos(ang) * mid, Math.sin(ang) * mid, 0]} rotation={[0, 0, ang - Math.PI / 2]}>
              <boxGeometry args={[0.035, radius - 0.1, 0.035]} />
              <meshStandardMaterial map={wood} roughness={0.8} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

export interface CannonProps extends GroupProps {
  /** barrel elevation, degrees */
  elevationDeg?: number;
  spinRef?: RefObject<number>;
  bronze?: boolean;
}

/** Field cannon on a wooden carriage; origin on the ground under the axle, barrel toward +x. */
export const Cannon = forwardRef<THREE.Group, CannonProps>(function Cannon({ elevationDeg = 0, spinRef, bronze = true, ...group }, ref) {
  const wheelR = 0.5;
  const wood = woodTexture("medium", 3);
  const metal = bronze ? { color: "#9a7140", metalness: 0.85, roughness: 0.32 } : { color: "#2e2f33", metalness: 0.8, roughness: 0.4 };
  const elev = THREE.MathUtils.degToRad(elevationDeg);
  return (
    <group ref={ref} {...group}>
      {/* trail beam resting on the ground behind the wheels */}
      <mesh position={[-0.74, 0.31, 0]} rotation={[0, 0, 0.25]} castShadow>
        <boxGeometry args={[1.85, 0.16, 0.26]} />
        <meshStandardMaterial map={wood} roughness={0.85} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.58, 0.17 * s]} castShadow>
          <boxGeometry args={[0.8, 0.42, 0.07]} />
          <meshStandardMaterial map={wood} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, wheelR, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.98, 10]} />
        <meshStandardMaterial color="#26262a" metalness={0.8} roughness={0.4} />
      </mesh>
      <SpokedWheel radius={wheelR} z={0.45} spinRef={spinRef} />
      <SpokedWheel radius={wheelR} z={-0.45} spinRef={spinRef} />
      {/* barrel pivots on its trunnions */}
      <group position={[0, CANNON_PIVOT_Y, 0]} rotation={[0, 0, elev]}>
        <mesh position={[0.375, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.11, 0.16, 1.65, 24]} />
          <meshStandardMaterial {...metal} />
        </mesh>
        <mesh position={[-0.38, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.175, 0.175, 0.12, 24]} />
          <meshStandardMaterial {...metal} />
        </mesh>
        <mesh position={[1.14, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.135, 0.135, 0.11, 24]} />
          <meshStandardMaterial {...metal} />
        </mesh>
        <mesh position={[1.2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.075, 0.075, 0.02, 18]} />
          <meshStandardMaterial color="#050505" roughness={1} />
        </mesh>
        <mesh position={[-0.52, 0, 0]}>
          <sphereGeometry args={[0.07, 14, 12]} />
          <meshStandardMaterial {...metal} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.42, 12]} />
          <meshStandardMaterial {...metal} />
        </mesh>
      </group>
    </group>
  );
});

/* ---------------- small arms ---------------- */

/** Rifle bullet, nose toward +x, `length` metres long (real ≈ 0.03 m — scenes enlarge it). */
export const Bullet = forwardRef<THREE.Group, GroupProps & { length?: number }>(function Bullet({ length = 0.03, ...group }, ref) {
  const geo = latheProfile(
    "bullet",
    [[0, 0], [0.24, 0], [0.25, 0.05], [0.25, 0.55], [0.225, 0.72], [0.16, 0.87], [0.07, 0.97], [0, 1]],
    20,
  );
  return (
    <group ref={ref} {...group}>
      <mesh geometry={geo} rotation={[0, 0, -Math.PI / 2]} position={[-length / 2, 0, 0]} scale={length} castShadow>
        <meshStandardMaterial color="#c07a3d" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
});

/** Rifle on a bench rest; muzzle at the group's origin pointing +x. */
export function Rifle(group: GroupProps) {
  const wood = woodTexture("dark", 2);
  return (
    <group {...group}>
      <mesh position={[-0.4, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.012, 0.016, 0.8, 12]} />
        <meshStandardMaterial color="#2b2d31" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[-0.86, -0.005, 0]} castShadow>
        <boxGeometry args={[0.22, 0.07, 0.05]} />
        <meshStandardMaterial color="#2b2d31" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[-0.86, 0.075, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.022, 0.022, 0.3, 12]} />
        <meshStandardMaterial color="#111114" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[-0.62, -0.035, 0]} castShadow>
        <boxGeometry args={[0.42, 0.05, 0.055]} />
        <meshStandardMaterial map={wood} roughness={0.7} />
      </mesh>
      <mesh position={[-1.12, -0.06, 0]} rotation={[0, 0, 0.18]} castShadow>
        <boxGeometry args={[0.42, 0.11, 0.055]} />
        <meshStandardMaterial map={wood} roughness={0.7} />
      </mesh>
      <mesh position={[-0.94, -0.07, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.05, 0.12, 0.05]} />
        <meshStandardMaterial map={wood} roughness={0.7} />
      </mesh>
      {/* bench rest */}
      <mesh position={[-0.55, -0.32, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.55, 10]} />
        <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[-0.55, -0.6, 0]}>
        <boxGeometry args={[0.5, 0.04, 0.35]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[-0.55, -0.055, 0]}>
        <boxGeometry args={[0.08, 0.03, 0.08]} />
        <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
}

/* ---------------- boxes, crates, weights ---------------- */

export interface CrateProps extends GroupProps {
  size?: [number, number, number];
  tone?: "light" | "medium" | "dark";
  /** draw a darker frame along the edges (shipping crate look) */
  frame?: boolean;
  label?: string;
}

/** Wooden crate/block centred on the group origin. */
export const WoodenCrate = forwardRef<THREE.Group, CrateProps>(function WoodenCrate({ size = [1, 1, 1], tone = "light", frame = true, label, ...group }, ref) {
  const [w, h, d] = size;
  const wood = woodTexture(tone, 4);
  const dark = woodTexture("dark", 2);
  const t = Math.min(w, h, d) * 0.09;
  const labelTex = useMemo(() => (label ? textTexture(label, { color: "#1c1917", font: "bold 46px sans-serif", width: 256, height: 128 }) : null), [label]);
  const edges = useMemo(() => {
    const list: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (const y of [-1, 1]) for (const z of [-1, 1]) list.push({ p: [0, (y * (h - t)) / 2, (z * (d - t)) / 2], s: [w + 0.002, t, t] });
    for (const x of [-1, 1]) for (const z of [-1, 1]) list.push({ p: [(x * (w - t)) / 2, 0, (z * (d - t)) / 2], s: [t, h + 0.002, t] });
    for (const x of [-1, 1]) for (const y of [-1, 1]) list.push({ p: [(x * (w - t)) / 2, (y * (h - t)) / 2, 0], s: [t, t, d + 0.002] });
    return list;
  }, [w, h, d, t]);
  return (
    <group ref={ref} {...group}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial map={wood} roughness={0.85} />
      </mesh>
      {frame &&
        edges.map((e, i) => (
          <mesh key={i} position={e.p} castShadow>
            <boxGeometry args={e.s} />
            <meshStandardMaterial map={dark} roughness={0.85} />
          </mesh>
        ))}
      {labelTex && (
        <mesh position={[0, 0, d / 2 + 0.003]}>
          <planeGeometry args={[w * 0.7, h * 0.35]} />
          <meshStandardMaterial map={labelTex} transparent roughness={0.9} />
        </mesh>
      )}
    </group>
  );
});

/** Cast-iron kettlebell (гиря) with its mass written on it; sits on y = 0. */
export const Kettlebell = forwardRef<THREE.Group, GroupProps & { radius?: number; label?: string }>(function Kettlebell({ radius = 0.12, label = "16 кг", ...group }, ref) {
  const tex = useMemo(() => textTexture(label, { color: "#e7e5e4", font: "bold 40px sans-serif", width: 256, height: 96 }), [label]);
  const r = radius;
  return (
    <group ref={ref} {...group}>
      <mesh position={[0, r * 0.95, 0]} scale={[1, 0.92, 1]} castShadow>
        <sphereGeometry args={[r, 26, 20]} />
        <meshStandardMaterial color="#2f3136" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, r * 0.12, 0]}>
        <cylinderGeometry args={[r * 0.62, r * 0.66, r * 0.24, 22]} />
        <meshStandardMaterial color="#2f3136" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, r * 1.78, 0]} castShadow>
        <torusGeometry args={[r * 0.52, r * 0.13, 10, 24, Math.PI]} />
        <meshStandardMaterial color="#2f3136" metalness={0.6} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * r * 0.52, r * 1.6, 0]}>
          <cylinderGeometry args={[r * 0.13, r * 0.13, r * 0.4, 10]} />
          <meshStandardMaterial color="#2f3136" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, r * 0.95, r * 0.93]}>
        <planeGeometry args={[r * 1.1, r * 0.42]} />
        <meshStandardMaterial map={tex} transparent roughness={0.6} />
      </mesh>
    </group>
  );
});

/** Brass slotted lab mass with a hook on top. Origin at the hook tip (hang it from a spring end). */
export const HangingWeight = forwardRef<THREE.Group, GroupProps & { height?: number; radius?: number; label?: string }>(function HangingWeight(
  { height = 0.4, radius = 0.16, label = "1 кг", ...group },
  ref,
) {
  const tex = useMemo(() => textTexture(label, { color: "#3b2508", font: "bold 44px sans-serif", width: 256, height: 96 }), [label]);
  const plates = 3;
  const plateH = (height * 0.8) / plates;
  return (
    <group ref={ref} {...group}>
      <mesh position={[0, -0.05, 0]}>
        <torusGeometry args={[0.045, 0.012, 8, 16, Math.PI * 1.4]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.11, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.12, 8]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      {Array.from({ length: plates }, (_, i) => (
        <mesh key={i} position={[0, -0.17 - plateH / 2 - i * plateH, 0]} castShadow>
          <cylinderGeometry args={[radius, radius, plateH * 0.94, 28]} />
          <meshStandardMaterial color="#c9a227" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, -0.17 - plateH * 1.5, radius + 0.002]}>
        <planeGeometry args={[radius * 1.4, plateH * 0.8]} />
        <meshStandardMaterial map={tex} transparent roughness={0.6} />
      </mesh>
    </group>
  );
});

/* ---------------- wheels, swings ---------------- */

/** Bicycle wheel lying in the xy-plane, centre at origin: tyre, rim, 24 spokes, hub and a valve at angle 0 (+x). */
export const BicycleWheel = forwardRef<THREE.Group, GroupProps & { radius?: number; valveColor?: string }>(function BicycleWheel({ radius = 1, valveColor = "#facc15", ...group }, ref) {
  const R = radius;
  const spokes = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const ang = (i / 24) * Math.PI * 2;
        const zOff = (i % 2 ? 1 : -1) * 0.05 * R;
        const hub = new THREE.Vector3(Math.cos(ang + 0.25) * 0.06 * R, Math.sin(ang + 0.25) * 0.06 * R, zOff);
        const rim = new THREE.Vector3(Math.cos(ang) * 0.9 * R, Math.sin(ang) * 0.9 * R, 0);
        const dir = rim.clone().sub(hub);
        const len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
        return { pos: hub.clone().add(rim).multiplyScalar(0.5), q, len };
      }),
    [R],
  );
  return (
    <group ref={ref} {...group}>
      <mesh castShadow>
        <torusGeometry args={[R, 0.06 * R, 12, 64]} />
        <meshStandardMaterial color="#18181b" roughness={0.9} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.92 * R, 0.03 * R, 8, 64]} />
        <meshStandardMaterial color="#c9ccd3" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07 * R, 0.07 * R, 0.22 * R, 16]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.85} roughness={0.3} />
      </mesh>
      {spokes.map((s, i) => (
        <mesh key={i} position={s.pos} quaternion={s.q}>
          <cylinderGeometry args={[0.006 * R, 0.006 * R, s.len, 5]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0.86 * R, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02 * R, 0.02 * R, 0.12 * R, 8]} />
        <meshStandardMaterial color={valveColor} emissive={valveColor} emissiveIntensity={0.6} metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
});

/** A-frame of a playground swing; the top bar (pivot axis along z) sits at `height`. */
export function SwingFrame({ height = 2.6, span = 1.6, ...group }: GroupProps & { height?: number; span?: number }) {
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const spread = 0.9;
  const legLen = Math.hypot(height, spread);
  const tilt = Math.atan2(spread, height);
  return (
    <group {...group}>
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, span + 0.3, 12]} />
        <meshStandardMaterial color="#2563eb" metalness={0.5} roughness={0.4} />
      </mesh>
      {legs.map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[(sx * spread) / 2, height / 2, (sz * (span + 0.2)) / 2]} rotation={[0, 0, sx * tilt]} castShadow>
          <cylinderGeometry args={[0.045, 0.045, legLen, 10]} />
          <meshStandardMaterial color="#2563eb" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- elevator & scales ---------------- */

/** Panoramic elevator cab, floor at y = 0, open toward +z so the passenger is visible. */
export const ElevatorCab = forwardRef<THREE.Group, GroupProps & { width?: number; depth?: number; height?: number }>(function ElevatorCab(
  { width = 1.7, depth = 1.5, height = 2.4, ...group },
  ref,
) {
  const posts: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  return (
    <group ref={ref} {...group}>
      <mesh position={[0, -0.05, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, height + 0.05, 0]} castShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.5} />
      </mesh>
      {posts.map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[(x * (width - 0.06)) / 2, height / 2, (z * (depth - 0.06)) / 2]}>
          <boxGeometry args={[0.06, height, 0.06]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, height / 2, -depth / 2 + 0.01]}>
        <planeGeometry args={[width - 0.06, height]} />
        <meshStandardMaterial color="#9fb7d4" transparent opacity={0.16} metalness={0.2} roughness={0.05} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * width) / 2 - s * 0.01, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[depth - 0.06, height]} />
          <meshStandardMaterial color="#9fb7d4" transparent opacity={0.16} metalness={0.2} roughness={0.05} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, height * 0.45, -depth / 2 + 0.03]}>
        <boxGeometry args={[width - 0.1, 0.04, 0.04]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
});

/** Bathroom scale with a dark display window on its +z edge; top surface at y = 0.05. */
export function BathroomScale(group: GroupProps) {
  return (
    <group {...group}>
      <RoundedBox args={[0.36, 0.05, 0.34]} radius={0.02} smoothness={3} position={[0, 0.025, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#f1f5f9" roughness={0.3} />
      </RoundedBox>
      <mesh position={[0, 0.052, 0.12]}>
        <boxGeometry args={[0.14, 0.004, 0.06]} />
        <meshStandardMaterial color="#0b1220" emissive="#38bdf8" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

/* ---------------- ramps ---------------- */

/**
 * Triangular ramp (wedge) of slope `angleDeg`: the incline rises toward −x and its foot is
 * at the origin, width along z. The sloped top surface is what objects slide on.
 */
export function Ramp({ angleDeg, length, width = 1.4, surface = "wood", ...group }: GroupProps & { angleDeg: number; length: number; width?: number; surface?: "wood" | "concrete" | "snow" }) {
  const geometry = useMemo(() => {
    const a = THREE.MathUtils.degToRad(angleDeg);
    const run = length * Math.cos(a);
    const rise = length * Math.sin(a);
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-run, rise), new THREE.Vector2(-run, 0)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    g.translate(0, 0, -width / 2);
    return g;
  }, [angleDeg, length, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const wood = woodTexture("light", 6);
  return (
    <group {...group}>
      <mesh geometry={geometry} castShadow receiveShadow>
        {surface === "wood" ? (
          <meshStandardMaterial map={wood} roughness={0.85} />
        ) : surface === "snow" ? (
          <meshStandardMaterial color="#e8eef8" roughness={0.95} />
        ) : (
          <meshStandardMaterial color="#6b7280" roughness={0.95} />
        )}
      </mesh>
    </group>
  );
}
