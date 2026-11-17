import { forwardRef, useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { extrudeProfile } from "./shared";
import { canvasTexture, textTexture } from "./textures";

type GroupProps = Omit<ThreeElements["group"], "ref">;

interface WheelProps {
  radius: number;
  width: number;
  position: [number, number, number];
  rim?: string;
  /** rolling angle in radians (distance / radius); the wheel turns clockwise seen from +z when it grows */
  spinRef?: RefObject<number>;
  /** which face shows the hub pattern: +1 → +z, −1 → −z */
  side?: 1 | -1;
  tire?: string;
}

export function Wheel({ radius, width, position, rim = "#c9ccd3", spinRef, side = 1, tire = "#151517" }: WheelProps) {
  const spin = useRef<THREE.Group>(null!);
  useFrame(() => {
    if (spinRef && spin.current) spin.current.rotation.z = -(spinRef.current ?? 0);
  });
  return (
    <group position={position}>
      <group ref={spin}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[radius, radius, width, 28]} />
          <meshStandardMaterial color={tire} roughness={0.92} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[radius * 0.62, radius * 0.62, width + 0.012, 22]} />
          <meshStandardMaterial color={rim} metalness={0.75} roughness={0.32} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 0, (width / 2 + 0.008) * side]} rotation={[0, 0, (i / 3) * Math.PI]}>
            <boxGeometry args={[radius * 0.16, radius * 1.15, 0.014]} />
            <meshStandardMaterial color="#3f434b" metalness={0.5} roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[0, 0, (width / 2 + 0.012) * side]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[radius * 0.16, radius * 0.16, 0.02, 14]} />
          <meshStandardMaterial color="#e4e4e7" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */

export interface CarProps extends GroupProps {
  color?: string;
  spinRef?: RefObject<number>;
  /** 0..1 — brake-light brightness, read every frame */
  brakeRef?: RefObject<number>;
  headlights?: boolean;
  /** false renders only the body (e.g. a body bouncing on its suspension above separately drawn wheels) */
  wheels?: boolean;
}

const CAR_BODY: [number, number][] = [
  [-2.2, 0.3], [2.12, 0.3], [2.24, 0.42], [2.24, 0.74], [1.6, 0.86], [0.78, 0.94],
  [-1.72, 0.96], [-2.18, 0.92], [-2.26, 0.62], [-2.24, 0.4],
];
const CAR_GLASS: [number, number][] = [[0.76, 0.93], [0.08, 1.37], [-1.1, 1.39], [-1.74, 0.95]];
const CAR_ROOF: [number, number][] = [[0.1, 1.36], [-1.12, 1.38], [-1.13, 1.43], [0.07, 1.415]];

/**
 * Sedan, 4.4 m long, nose toward +x, wheels on y = 0. Rolling wheels via `spinRef`,
 * brake lights via `brakeRef`.
 */
export const Car = forwardRef<THREE.Group, CarProps>(function Car({ color = "#d43c33", spinRef, brakeRef, headlights = true, wheels = true, ...group }, ref) {
  const body = extrudeProfile("car-body", CAR_BODY, 1.68, 0.05);
  const glass = extrudeProfile("car-glass", CAR_GLASS, 1.5, 0.03);
  const roof = extrudeProfile("car-roof", CAR_ROOF, 1.56, 0.02);
  const brakeMat = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(() => {
    if (brakeMat.current) brakeMat.current.emissiveIntensity = 0.35 + 2.6 * (brakeRef?.current ?? 0);
  });
  return (
    <group ref={ref} {...group}>
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.32} />
      </mesh>
      <mesh geometry={glass} castShadow>
        <meshStandardMaterial color="#20324a" metalness={0.4} roughness={0.08} />
      </mesh>
      <mesh geometry={roof} castShadow>
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.32} />
      </mesh>
      <mesh position={[-0.46, 1.16, 0]}>
        <boxGeometry args={[0.08, 0.42, 1.54]} />
        <meshStandardMaterial color="#18181b" roughness={0.5} />
      </mesh>
      {/* bumpers + grille */}
      <mesh position={[2.27, 0.42, 0]}>
        <boxGeometry args={[0.08, 0.16, 1.7]} />
        <meshStandardMaterial color="#202024" roughness={0.6} />
      </mesh>
      <mesh position={[-2.29, 0.42, 0]}>
        <boxGeometry args={[0.08, 0.16, 1.7]} />
        <meshStandardMaterial color="#202024" roughness={0.6} />
      </mesh>
      <mesh position={[2.28, 0.62, 0]}>
        <boxGeometry args={[0.04, 0.12, 0.7]} />
        <meshStandardMaterial color="#0f0f12" roughness={0.4} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[2.27, 0.68, 0.62 * s]}>
            <boxGeometry args={[0.05, 0.12, 0.34]} />
            <meshStandardMaterial color="#fff6d8" emissive="#fff3c4" emissiveIntensity={headlights ? 1.4 : 0.2} toneMapped={false} />
          </mesh>
          <mesh position={[-2.29, 0.74, 0.64 * s]}>
            <boxGeometry args={[0.05, 0.12, 0.3]} />
            <meshStandardMaterial ref={s === 1 ? brakeMat : undefined} color="#7f1010" emissive="#ff2a2a" emissiveIntensity={0.35} toneMapped={false} />
          </mesh>
          {/* side mirror */}
          <mesh position={[0.62, 1.0, 0.92 * s]}>
            <boxGeometry args={[0.12, 0.1, 0.16]} />
            <meshStandardMaterial color={color} metalness={0.45} roughness={0.32} />
          </mesh>
          {/* door handles */}
          <mesh position={[0.05, 0.86, 0.9 * s]}>
            <boxGeometry args={[0.18, 0.03, 0.02]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {wheels && (
        <>
          <Wheel radius={0.34} width={0.26} position={[1.38, 0.34, 0.8]} spinRef={spinRef} side={1} />
          <Wheel radius={0.34} width={0.26} position={[-1.38, 0.34, 0.8]} spinRef={spinRef} side={1} />
          <Wheel radius={0.34} width={0.26} position={[1.38, 0.34, -0.8]} spinRef={spinRef} side={-1} />
          <Wheel radius={0.34} width={0.26} position={[-1.38, 0.34, -0.8]} spinRef={spinRef} side={-1} />
        </>
      )}
    </group>
  );
});

/* ------------------------------------------------------------------ */

const VAN_BODY: [number, number][] = [
  [-2.55, 0.36], [2.3, 0.36], [2.44, 0.58], [2.42, 1.08], [1.78, 1.28], [1.28, 2.36], [-2.55, 2.4],
];
const VAN_GLASS: [number, number][] = [[1.76, 1.3], [1.3, 2.26], [0.92, 2.26], [0.92, 1.3]];

function ambulanceSideTexture() {
  // UVs of an extrusion's caps are the shape's own (x, y) in metres → repeat/offset map the canvas onto the van side.
  const tex = canvasTexture("ambulance-side", 512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#f5f5f2";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d92b2b";
    ctx.fillRect(0, h * 0.58, w, h * 0.09);
    const cx = w * 0.32;
    const cy = h * 0.3;
    ctx.fillRect(cx - 9, cy - 32, 18, 64);
    ctx.fillRect(cx - 32, cy - 9, 64, 18);
    ctx.fillStyle = "#c62020";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("СКОРАЯ", w * 0.62, h * 0.82);
  });
  return tex;
}

export interface VanProps extends GroupProps {
  spinRef?: RefObject<number>;
  /** flashing roof lights */
  siren?: boolean;
}

/** Ambulance van, ~5 m long, nose toward +x. */
export const Ambulance = forwardRef<THREE.Group, VanProps>(function Ambulance({ spinRef, siren = true, ...group }, ref) {
  const body = extrudeProfile("van-body", VAN_BODY, 1.9, 0.05);
  const glass = extrudeProfile("van-glass", VAN_GLASS, 1.92, 0.02);
  const side = useMemo(() => {
    const t = ambulanceSideTexture().clone();
    t.repeat.set(1 / 5.1, 1 / 2.1);
    t.offset.set(2.55 / 5.1, -0.33 / 2.1);
    t.needsUpdate = true;
    return t;
  }, []);
  const red = useRef<THREE.MeshStandardMaterial>(null!);
  const blue = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    if (!red.current || !blue.current) return;
    const on = Math.floor(clock.elapsedTime * 4) % 2 === 0;
    red.current.emissiveIntensity = siren ? (on ? 3 : 0.2) : 0.2;
    blue.current.emissiveIntensity = siren ? (on ? 0.2 : 3) : 0.2;
  });
  return (
    <group ref={ref} {...group}>
      <mesh geometry={body} castShadow receiveShadow>
        <meshStandardMaterial attach="material-0" map={side} roughness={0.45} metalness={0.1} />
        <meshStandardMaterial attach="material-1" color="#f5f5f2" roughness={0.45} metalness={0.1} />
      </mesh>
      <mesh geometry={glass}>
        <meshStandardMaterial color="#20324a" metalness={0.4} roughness={0.08} />
      </mesh>
      <mesh position={[0.4, 2.47, 0.45]}>
        <boxGeometry args={[0.35, 0.16, 0.5]} />
        <meshStandardMaterial ref={red} color="#7f1010" emissive="#ff2020" emissiveIntensity={1} toneMapped={false} />
      </mesh>
      <mesh position={[0.4, 2.47, -0.45]}>
        <boxGeometry args={[0.35, 0.16, 0.5]} />
        <meshStandardMaterial ref={blue} color="#10207f" emissive="#3070ff" emissiveIntensity={1} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[2.45, 0.78, 0.66 * s]}>
          <boxGeometry args={[0.05, 0.14, 0.36]} />
          <meshStandardMaterial color="#fff6d8" emissive="#fff3c4" emissiveIntensity={1.2} toneMapped={false} />
        </mesh>
      ))}
      <Wheel radius={0.38} width={0.28} position={[1.6, 0.38, 0.86]} spinRef={spinRef} side={1} />
      <Wheel radius={0.38} width={0.28} position={[-1.65, 0.38, 0.86]} spinRef={spinRef} side={1} />
      <Wheel radius={0.38} width={0.28} position={[1.6, 0.38, -0.86]} spinRef={spinRef} side={-1} />
      <Wheel radius={0.38} width={0.28} position={[-1.65, 0.38, -0.86]} spinRef={spinRef} side={-1} />
    </group>
  );
});

/* ------------------------------------------------------------------ */

export interface LabCartProps extends GroupProps {
  /** cart length along x, metres */
  length?: number;
  color?: string;
  /** big number/letter on the cart's mast flag */
  tag?: string;
  /** bumper on the +x face: steel spring (elastic) or clay/velcro pad (sticky) */
  bumper?: "spring" | "clay" | "none";
  /** bumper on the −x face */
  backBumper?: "spring" | "clay" | "none";
  /** extra load blocks stacked on the deck (0–3) */
  load?: number;
  spinRef?: RefObject<number>;
}

/**
 * Physics-class dynamics cart: deck on four wheels, a flag with a label, and an optional
 * spring or clay bumper. Origin at the floor under its centre, front toward +x.
 */
export const LabCart = forwardRef<THREE.Group, LabCartProps>(function LabCart(
  { length = 1, color = "#3b82f6", tag, bumper = "none", backBumper = "none", load = 0, spinRef, ...group },
  ref,
) {
  const L = length;
  const W = 0.56 * L;
  const H = 0.2 * L;
  const r = 0.11 * L;
  const deckY = r * 1.25 + H / 2;
  const tagTex = useMemo(() => (tag ? textTexture(tag, { color: "#111", background: "#f4f4f5", font: "bold 80px sans-serif" }) : null), [tag]);
  const bumperMesh = (kind: "spring" | "clay" | "none", dir: 1 | -1) => {
    if (kind === "none") return null;
    if (kind === "clay") {
      return (
        <mesh position={[dir * (L / 2 + 0.05 * L), deckY, 0]} scale={[0.55, 1, 1]}>
          <sphereGeometry args={[0.13 * L, 16, 12]} />
          <meshStandardMaterial color="#e2b04a" roughness={0.95} />
        </mesh>
      );
    }
    const turns = 6;
    return (
      <group position={[dir * (L / 2), deckY, 0]}>
        {Array.from({ length: turns }, (_, i) => (
          <mesh key={i} position={[dir * (0.025 * L + i * 0.03 * L), 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.07 * L, 0.009 * L, 6, 18]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
          </mesh>
        ))}
        <mesh position={[dir * (0.2 * L), 0, 0]}>
          <boxGeometry args={[0.02 * L, 0.18 * L, 0.18 * L]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    );
  };
  return (
    <group ref={ref} {...group}>
      <RoundedBox args={[L, H, W]} radius={Math.min(H, W) * 0.25} smoothness={3} position={[0, deckY, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.45} />
      </RoundedBox>
      <mesh position={[0, deckY + H / 2 + 0.004 * L, 0]}>
        <boxGeometry args={[L * 0.9, 0.008 * L, W * 0.86]} />
        <meshStandardMaterial color="#27272a" roughness={0.85} />
      </mesh>
      {Array.from({ length: Math.min(3, Math.max(0, load)) }, (_, i) => (
        <RoundedBox key={i} args={[L * 0.42, H * 0.9, W * 0.62]} radius={0.02 * L} position={[0, deckY + H / 2 + H * 0.45 + i * H * 0.92, 0]} castShadow>
          <meshStandardMaterial color="#52525b" metalness={0.85} roughness={0.35} />
        </RoundedBox>
      ))}
      {tagTex && (
        <group position={[-L * 0.32, deckY + H / 2, 0]}>
          <mesh position={[0, 0.25 * L, 0]}>
            <cylinderGeometry args={[0.008 * L, 0.008 * L, 0.5 * L, 6]} />
            <meshStandardMaterial color="#a1a1aa" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0.1 * L, 0.42 * L, 0]}>
            <boxGeometry args={[0.2 * L, 0.14 * L, 0.006 * L]} />
            <meshStandardMaterial map={tagTex} roughness={0.6} />
          </mesh>
        </group>
      )}
      {bumperMesh(bumper, 1)}
      {bumperMesh(backBumper, -1)}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <Wheel key={`${sx}${sz}`} radius={r} width={0.07 * L} position={[sx * L * 0.32, r, sz * (W / 2 + 0.02 * L)]} spinRef={spinRef} side={sz as 1 | -1} rim="#e4e4e7" />
        )),
      )}
    </group>
  );
});

/* ------------------------------------------------------------------ */

export interface TruckProps extends GroupProps {
  color?: string;
  spinRef?: RefObject<number>;
}

/** distance from the truck origin back to the fifth-wheel coupling (trailer kingpin sits here) */
export const TRUCK_COUPLING_X = -1.35;

/** Cab-over semi tractor unit, ~6 m long, nose toward +x, wheels on y = 0. */
export const Truck = forwardRef<THREE.Group, TruckProps>(function Truck({ color = "#2563eb", spinRef, ...group }, ref) {
  const chrome = <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />;
  const glass = <meshStandardMaterial color="#1e2b3d" metalness={0.4} roughness={0.08} />;
  return (
    <group ref={ref} {...group}>
      <mesh position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[6, 0.32, 1.0]} />
        <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.5} />
      </mesh>
      <RoundedBox args={[2.3, 2.6, 2.45]} radius={0.12} smoothness={3} position={[1.75, 2.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.35} roughness={0.4} />
      </RoundedBox>
      <mesh position={[2.91, 2.78, 0]}>
        <boxGeometry args={[0.04, 0.95, 2.1]} />
        {glass}
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[2.2, 2.8, 1.23 * s]}>
            <boxGeometry args={[0.95, 0.75, 0.02]} />
            {glass}
          </mesh>
          <mesh position={[2.93, 1.2, 0.88 * s]}>
            <boxGeometry args={[0.05, 0.18, 0.4]} />
            <meshStandardMaterial color="#fff6d8" emissive="#fff3c4" emissiveIntensity={1.3} toneMapped={false} />
          </mesh>
          <mesh position={[0.25, 0.82, 1.02 * s]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 1.3, 18]} />
            {chrome}
          </mesh>
          <mesh position={[2.85, 2.9, 1.33 * s]}>
            <boxGeometry args={[0.1, 0.42, 0.06]} />
            <meshStandardMaterial color="#111" roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[2.92, 1.6, 0]}>
        <boxGeometry args={[0.05, 0.7, 1.55]} />
        <meshStandardMaterial color="#27272a" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[2.97, 0.78, 0]} castShadow>
        <boxGeometry args={[0.22, 0.34, 2.45]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0.45, 2.9, 1.05]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 2.0, 12]} />
        {chrome}
      </mesh>
      {/* fifth wheel coupling */}
      <mesh position={[TRUCK_COUPLING_X, 1.08, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.12, 24]} />
        <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.35} />
      </mesh>
      {[1.9, -1.0, -2.2].map((x) =>
        [-1, 1].map((s) => <Wheel key={`${x}${s}`} radius={0.52} width={0.42} position={[x, 0.52, 1.0 * s]} spinRef={spinRef} side={s as 1 | -1} rim="#9ca3af" />),
      )}
    </group>
  );
});

/** trailer kingpin position in the trailer's own frame */
export const TRAILER_KINGPIN_X = 3.9;

/** Box semi-trailer, 9 m long; its kingpin rests on the truck's fifth wheel. */
export const Trailer = forwardRef<THREE.Group, GroupProps & { spinRef?: RefObject<number>; label?: string }>(function Trailer({ spinRef, label = "ГРУЗ", ...group }, ref) {
  const tex = useMemo(() => textTexture(label, { color: "#1d4ed8", background: "#f8fafc", font: "bold 64px sans-serif", width: 512, height: 128 }), [label]);
  return (
    <group ref={ref} {...group}>
      <mesh position={[0, 2.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[9, 2.8, 2.5]} />
        <meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 2.75, 1.252 * s]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[5, 1.25]} />
          <meshStandardMaterial map={tex} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 1.25, 0]}>
        <boxGeometry args={[9, 0.22, 1.1]} />
        <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[TRAILER_KINGPIN_X, 1.2, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.3, 10]} />
        <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.35} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[2.5, 0.75, 0.8 * s]}>
          <boxGeometry args={[0.12, 0.9, 0.12]} />
          <meshStandardMaterial color="#374151" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {[-2.8, -3.95].map((x) =>
        [-1, 1].map((s) => <Wheel key={`${x}${s}`} radius={0.52} width={0.42} position={[x, 0.52, 1.0 * s]} spinRef={spinRef} side={s as 1 | -1} rim="#9ca3af" />),
      )}
      <mesh position={[-4.52, 2.75, 0]}>
        <boxGeometry args={[0.04, 2.7, 2.4]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-4.55, 1.05, 0.95 * s]}>
          <boxGeometry args={[0.05, 0.14, 0.3]} />
          <meshStandardMaterial color="#7f1010" emissive="#ff2a2a" emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
});

/**
 * Spring scale (динамометр) lying along x: hook at −x end (attach to the body),
 * pull ring at +x. `stretch` 0..1 moves the red indicator along the scale.
 */
export function Dynamometer({ length = 0.6, stretch = 0.5, ...group }: GroupProps & { length?: number; stretch?: number }) {
  const L = length;
  return (
    <group {...group}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06 * L, 0.06 * L, L, 16]} />
        <meshStandardMaterial color="#e2e8f0" transparent opacity={0.55} roughness={0.15} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-0.4 * L + i * 0.1 * L, 0.061 * L, 0]}>
          <boxGeometry args={[0.006 * L, 0.004, 0.05 * L]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      <mesh position={[-0.4 * L + Math.min(1, Math.max(0, stretch)) * 0.8 * L, 0, 0]}>
        <boxGeometry args={[0.02 * L, 0.1 * L, 0.1 * L]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[-0.56 * L, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.05 * L, 0.01 * L, 6, 14, Math.PI * 1.5]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0.58 * L, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.07 * L, 0.012 * L, 6, 18]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
}
