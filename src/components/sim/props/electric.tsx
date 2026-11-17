import { forwardRef, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { badgeTexture, canvasTexture, textTexture } from "./textures";

type GroupProps = Omit<ThreeElements["group"], "ref">;

/** AA-style battery lying along x: + terminal toward +x. Length ≈ 1 at scale 1. */
export function Battery({ voltage = "1,5 В", ...group }: GroupProps & { voltage?: string }) {
  const label = useMemo(
    () =>
      canvasTexture(`battery-${voltage}`, 512, 128, (ctx, w, h) => {
        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(w * 0.68, 0, w * 0.32, h);
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 46px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(voltage, w * 0.36, h / 2);
        ctx.fillStyle = "#111827";
        ctx.fillText("+", w * 0.84, h / 2);
      }),
    [voltage],
  );
  return (
    <group {...group}>
      <mesh rotation={[0, 0, -Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.9, 28, 1, true]} />
        <meshStandardMaterial map={label} roughness={0.35} metalness={0.3} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.45, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.16, 0.16, 0.01, 28]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0.49, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 0.07, 16]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
      </mesh>
    </group>
  );
}

/** Light bulb standing on its screw base (base at y = 0). `brightnessRef`/`brightness` 0..1 lights the filament. */
export function LightBulb({ brightness = 0, brightnessRef, color = "#fde68a", ...group }: GroupProps & { brightness?: number; brightnessRef?: RefObject<number>; color?: string }) {
  const glass = useRef<THREE.MeshStandardMaterial>(null!);
  const filament = useRef<THREE.MeshStandardMaterial>(null!);
  const light = useRef<THREE.PointLight>(null!);
  const apply = (b: number) => {
    const k = THREE.MathUtils.clamp(b, 0, 1.5);
    if (glass.current) glass.current.emissiveIntensity = 0.05 + k * 1.6;
    if (filament.current) filament.current.emissiveIntensity = 0.2 + k * 6;
    if (light.current) light.current.intensity = k * 2.5;
  };
  useEffect(() => {
    if (!brightnessRef) apply(brightness);
  });
  useFrame(() => {
    if (brightnessRef) apply(brightnessRef.current ?? 0);
  });
  return (
    <group {...group}>
      {/* screw base */}
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.12, 0.1, 0.24, 20]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.3} />
      </mesh>
      {[0.05, 0.11, 0.17].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <torusGeometry args={[0.118, 0.012, 6, 20]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0, 0.26, 0]}>
        <cylinderGeometry args={[0.11, 0.13, 0.06, 20]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      {/* glass bulb */}
      <mesh position={[0, 0.52, 0]}>
        <sphereGeometry args={[0.26, 28, 22]} />
        <meshStandardMaterial ref={glass} color="#fef9c3" emissive={color} emissiveIntensity={0.05} transparent opacity={0.45} roughness={0.05} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* filament */}
      <mesh position={[0, 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.07, 0.008, 6, 16, Math.PI]} />
        <meshStandardMaterial ref={filament} color="#78350f" emissive="#fbbf24" emissiveIntensity={0.2} toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.07, 0.39, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 0.22, 4]} />
          <meshStandardMaterial color="#9ca3af" />
        </mesh>
      ))}
      <pointLight ref={light} position={[0, 0.52, 0]} color={color} intensity={0} distance={4} />
    </group>
  );
}

const BAND_COLORS = ["#111", "#7c2d12", "#dc2626", "#f97316", "#facc15", "#16a34a", "#2563eb", "#7c3aed", "#6b7280", "#f8fafc"];

/** Through-hole resistor along x with colour bands encoding `ohms` (two digits + multiplier). Length ≈ 1. */
export function Resistor({ ohms = 100, ...group }: GroupProps & { ohms?: number }) {
  const bands = useMemo(() => {
    const v = Math.max(1, Math.round(ohms));
    const exp = Math.max(0, Math.floor(Math.log10(v)) - 1);
    const digits = Math.round(v / 10 ** exp);
    return [Math.floor(digits / 10) % 10, digits % 10, Math.min(9, exp)];
  }, [ohms]);
  return (
    <group {...group}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.12, 0.42, 6, 16]} />
        <meshStandardMaterial color="#d9c49a" roughness={0.6} />
      </mesh>
      {bands.map((d, i) => (
        <mesh key={i} position={[-0.16 + i * 0.12, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.123, 0.123, 0.05, 20]} />
          <meshStandardMaterial color={BAND_COLORS[d]} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0.24, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.123, 0.123, 0.05, 20]} />
        <meshStandardMaterial color="#d4a017" metalness={0.7} roughness={0.3} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.42, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 0.28, 6]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/** Insulated wire through a list of points (static). */
export function Wire({ points, color = "#dc2626", radius = 0.03, closed = false }: { points: [number, number, number][]; color?: string; radius?: number; closed?: boolean }) {
  const geometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      closed,
      "catmullrom",
      0.05,
    );
    return new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), radius, 8, closed);
  }, [points, radius, closed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color={color} roughness={0.55} />
    </mesh>
  );
}

/** Bar magnet along x: N (red) half toward +x, S (blue) half toward −x. */
export const BarMagnet = forwardRef<THREE.Group, GroupProps & { length?: number; thickness?: number }>(function BarMagnet({ length = 1.6, thickness = 0.3, ...group }, ref) {
  const n = useMemo(() => textTexture("N", { color: "#ffffff", background: "#dc2626", font: "bold 90px sans-serif" }), []);
  const sTex = useMemo(() => textTexture("S", { color: "#ffffff", background: "#2563eb", font: "bold 90px sans-serif" }), []);
  return (
    <group ref={ref} {...group}>
      <mesh position={[length / 4, 0, 0]} castShadow>
        <boxGeometry args={[length / 2, thickness, thickness]} />
        <meshStandardMaterial color="#dc2626" roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[-length / 4, 0, 0]} castShadow>
        <boxGeometry args={[length / 2, thickness, thickness]} />
        <meshStandardMaterial color="#2563eb" roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[length / 4, 0, thickness / 2 + 0.002]}>
        <planeGeometry args={[thickness * 0.8, thickness * 0.8]} />
        <meshStandardMaterial map={n} />
      </mesh>
      <mesh position={[-length / 4, 0, thickness / 2 + 0.002]}>
        <planeGeometry args={[thickness * 0.8, thickness * 0.8]} />
        <meshStandardMaterial map={sTex} />
      </mesh>
      <mesh position={[length / 4, thickness / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[thickness * 0.8, thickness * 0.8]} />
        <meshStandardMaterial map={n} />
      </mesh>
      <mesh position={[-length / 4, thickness / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[thickness * 0.8, thickness * 0.8]} />
        <meshStandardMaterial map={sTex} />
      </mesh>
    </group>
  );
});

/** Compass lying flat; the needle points along `angle` (radians, in the xz-plane from +x toward −z). */
export function Compass({ angle = 0, angleRef, radius = 0.22, ...group }: GroupProps & { angle?: number; angleRef?: RefObject<number>; radius?: number }) {
  const needle = useRef<THREE.Group>(null!);
  useFrame(() => {
    if (needle.current) needle.current.rotation.y = angleRef?.current ?? angle;
  });
  return (
    <group {...group}>
      <mesh>
        <cylinderGeometry args={[radius, radius, 0.06, 28]} />
        <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.9, 28]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>
      <group ref={needle} position={[0, 0.045, 0]}>
        <mesh position={[radius * 0.4, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[radius * 0.12, radius * 0.8, 4]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
        <mesh position={[-radius * 0.4, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[radius * 0.12, radius * 0.8, 4]} />
          <meshStandardMaterial color="#1e3a8a" />
        </mesh>
      </group>
    </group>
  );
}

/** Copper coil (solenoid) along x, centred on the origin. */
export function Coil({ turns = 12, radius = 0.4, length = 1.4, wire = 0.035, color = "#b87333", ...group }: GroupProps & { turns?: number; radius?: number; length?: number; wire?: number; color?: string }) {
  const geometry = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const steps = turns * 24;
    for (let i = 0; i <= steps; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(new THREE.Vector3(-length / 2 + (i / steps) * length, Math.sin(a) * radius, Math.cos(a) * radius));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, wire, 6, false);
  }, [turns, radius, length, wire]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group {...group}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial color={color} metalness={0.85} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Charged ball: a sphere with a "+"/"−" badge that always faces the camera. */
export const ChargedBall = forwardRef<THREE.Group, GroupProps & { sign?: 1 | -1; radius?: number; color?: string }>(function ChargedBall({ sign = 1, radius = 0.3, color, ...group }, ref) {
  const fill = color ?? (sign > 0 ? "#dc2626" : "#2563eb");
  const badge = useMemo(() => badgeTexture(sign > 0 ? "+" : "−", fill), [sign, fill]);
  return (
    <group ref={ref} {...group}>
      <mesh castShadow>
        <sphereGeometry args={[radius, 32, 24]} />
        <meshStandardMaterial color={fill} metalness={0.5} roughness={0.25} emissive={fill} emissiveIntensity={0.25} />
      </mesh>
      <sprite position={[0, 0, 0]} scale={radius * 1.1} renderOrder={2}>
        <spriteMaterial map={badge} depthTest={false} transparent />
      </sprite>
    </group>
  );
});

function phoneScreen(signal: boolean) {
  return canvasTexture(`phone-${signal}`, 128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, signal ? "#1e3a8a" : "#3f3f46");
    g.addColorStop(1, signal ? "#0ea5e9" : "#18181b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f8fafc";
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = signal || i === 0 ? 1 : 0.2;
      ctx.fillRect(12 + i * 9, 22 - i * 4, 6, 6 + i * 4);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(signal ? "4G" : "Нет сети", w / 2, h / 2);
  });
}

/** Smartphone standing upright, screen toward +z; `signal` switches the status shown on the screen. */
export function Phone({ signal = true, ...group }: GroupProps & { signal?: boolean }) {
  const screen = useMemo(() => phoneScreen(signal), [signal]);
  return (
    <group {...group}>
      <mesh castShadow>
        <boxGeometry args={[0.36, 0.72, 0.04]} />
        <meshStandardMaterial color="#111827" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[0.32, 0.64]} />
        <meshStandardMaterial map={screen} emissive="#ffffff" emissiveMap={screen} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

/** Van de Graaff generator: insulating column with a polished metal dome; dome centre at y = height. */
export function VanDeGraaff({ height = 1.6, dome = 0.45, ...group }: GroupProps & { height?: number; dome?: number }) {
  return (
    <group {...group}>
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.7, 0.16, 0.5]} />
        <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.13, 0.13, height - dome * 0.6, 20]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.5} roughness={0.1} />
      </mesh>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[0.06, height - dome * 0.8, 0.02]} />
        <meshStandardMaterial color="#111827" roughness={0.8} />
      </mesh>
      <mesh position={[0, height, 0]} castShadow>
        <sphereGeometry args={[dome, 32, 24]} />
        <meshStandardMaterial color="#d4d4d8" metalness={1} roughness={0.12} />
      </mesh>
    </group>
  );
}
