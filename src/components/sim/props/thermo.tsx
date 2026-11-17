import { useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { canvasTexture } from "./textures";

type GroupProps = Omit<ThreeElements["group"], "ref">;

/** Glass tank with a dark metal frame; centred on the origin. */
export function GlassVessel({ size, frameColor = "#334155", ...group }: GroupProps & { size: [number, number, number]; frameColor?: string }) {
  const [w, h, d] = size;
  const t = 0.04;
  const edges = useMemo(() => {
    const list: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (const y of [-1, 1]) for (const z of [-1, 1]) list.push({ p: [0, (y * h) / 2, (z * d) / 2], s: [w + t, t, t] });
    for (const x of [-1, 1]) for (const z of [-1, 1]) list.push({ p: [(x * w) / 2, 0, (z * d) / 2], s: [t, h + t, t] });
    for (const x of [-1, 1]) for (const y of [-1, 1]) list.push({ p: [(x * w) / 2, (y * h) / 2, 0], s: [t, t, d + t] });
    return list;
  }, [w, h, d]);
  return (
    <group {...group}>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#dbeafe" transparent opacity={0.08} roughness={0.05} metalness={0.1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -h / 2 - 0.03, 0]} receiveShadow>
        <boxGeometry args={[w + 0.12, 0.06, d + 0.12]} />
        <meshStandardMaterial color="#1e293b" metalness={0.4} roughness={0.5} />
      </mesh>
      {edges.map((e, i) => (
        <mesh key={i} position={e.p}>
          <boxGeometry args={e.s} />
          <meshStandardMaterial color={frameColor} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function dialTexture(label: string) {
  return canvasTexture(`dial-${label}`, 256, 256, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      const r1 = w * 0.38;
      const r2 = i % 5 === 0 ? w * 0.3 : w * 0.34;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.41, Math.PI * 0.75 + Math.PI * 1.2, Math.PI * 0.75 + Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, cx, cy + w * 0.3);
  });
}

/**
 * Round dial gauge (manometer, ammeter...) facing +z. The needle sweeps 270°;
 * `valueRef.current` (0..1) is read every frame, or pass a static `value`.
 */
export function DialGauge({ label = "P", value = 0, valueRef, radius = 0.3, ...group }: GroupProps & { label?: string; value?: number; valueRef?: RefObject<number>; radius?: number }) {
  const needle = useRef<THREE.Group>(null!);
  const tex = useMemo(() => dialTexture(label), [label]);
  const shown = useRef(value);
  useFrame((_, dt) => {
    const target = THREE.MathUtils.clamp(valueRef?.current ?? value, 0, 1.05);
    // a little inertia like a real needle
    shown.current += (target - shown.current) * Math.min(1, dt * 6);
    if (needle.current) needle.current.rotation.z = -(Math.PI * 0.75 + shown.current * Math.PI * 1.5) + Math.PI / 2 + Math.PI;
  });
  return (
    <group {...group}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 1.08, radius * 1.08, 0.08, 32]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.041]}>
        <circleGeometry args={[radius, 40]} />
        <meshStandardMaterial map={tex} roughness={0.6} />
      </mesh>
      <group ref={needle} position={[0, 0, 0.05]}>
        <mesh position={[0, radius * 0.38, 0]}>
          <boxGeometry args={[radius * 0.05, radius * 0.8, 0.01]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
      <mesh position={[0, 0, 0.056]}>
        <circleGeometry args={[radius * 0.07, 16]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
    </group>
  );
}

/** Glass thermometer standing on its bulb; `levelRef.current` / `level` (0..1) sets the red column. */
export function Thermometer({ level = 0.5, levelRef, height = 1.4, ...group }: GroupProps & { level?: number; levelRef?: RefObject<number>; height?: number }) {
  const column = useRef<THREE.Mesh>(null!);
  const tube = height - 0.14;
  useFrame(() => {
    const l = THREE.MathUtils.clamp(levelRef?.current ?? level, 0.02, 1);
    if (column.current) {
      column.current.scale.y = l;
      column.current.position.y = 0.1 + (tube * l) / 2;
    }
  });
  return (
    <group {...group}>
      <mesh position={[0, 0.07, 0]}>
        <sphereGeometry args={[0.07, 18, 14]} />
        <meshStandardMaterial color="#dc2626" emissive="#b91c1c" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 0.1 + tube / 2, 0]}>
        <cylinderGeometry args={[0.035, 0.035, tube, 14, 1, true]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.25} roughness={0.05} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={column} position={[0, 0.1 + tube / 4, 0]}>
        <cylinderGeometry args={[0.018, 0.018, tube, 10]} />
        <meshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.6} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[0.045, 0.1 + ((i + 1) / 10) * tube, 0]}>
          <boxGeometry args={[i % 2 ? 0.03 : 0.05, 0.006, 0.006]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      ))}
    </group>
  );
}

/** Gas burner with a flickering blue flame; `power` 0..1 scales the flame. */
export function Burner({ power = 1, ...group }: GroupProps & { power?: number }) {
  const flame = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    if (!flame.current) return;
    const k = Math.max(0.05, power) * (1 + 0.08 * Math.sin(clock.elapsedTime * 23) + 0.05 * Math.sin(clock.elapsedTime * 37));
    flame.current.scale.set(1, k, 1);
    flame.current.visible = power > 0.01;
  });
  return (
    <group {...group}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.12, 24]} />
        <meshStandardMaterial color="#27272a" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.12, 16]} />
        <meshStandardMaterial color="#71717a" metalness={0.8} roughness={0.3} />
      </mesh>
      <group ref={flame} position={[0, 0.23, 0]}>
        <mesh position={[0, 0.16, 0]}>
          <coneGeometry args={[0.09, 0.34, 16, 1, true]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.75} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <coneGeometry args={[0.05, 0.2, 14, 1, true]} />
          <meshBasicMaterial color="#e0f2fe" transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Rising, fading puffs of steam over a hot liquid; purely decorative loop. */
export function Steam({ count = 7, spread = 0.6, height = 1.4, ...group }: GroupProps & { count?: number; spread?: number; height?: number }) {
  const puffs = useRef<(THREE.Mesh | null)[]>([]);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ x: Math.sin(i * 12.9898) * spread, z: Math.cos(i * 78.233) * spread * 0.6, phase: i / count })), [count, spread]);
  useFrame(({ clock }) => {
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const u = (clock.elapsedTime * 0.25 + seeds[i].phase) % 1;
      m.position.set(seeds[i].x + Math.sin(u * 6 + i) * 0.08, u * height, seeds[i].z);
      m.scale.setScalar(0.05 + u * 0.16);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.2 * Math.sin(u * Math.PI);
    });
  });
  return (
    <group {...group}>
      {seeds.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            puffs.current[i] = m;
          }}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#f1f5f9" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
