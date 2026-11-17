import { useMemo, useRef, type RefObject } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import * as THREE from "three";
import { canvasTexture, textTexture } from "./textures";
import { PSU_MINUS, PSU_PLUS, RHEO_LEFT, RHEO_RIGHT } from "./circuitLayout";

type GroupProps = Omit<ThreeElements["group"], "ref">;

/** The same curve the `Wire` prop draws, so moving charges stay inside the visible wire. */
function wireCurve(points: [number, number, number][], closed = false) {
  return new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    closed,
    "catmullrom",
    0.05,
  );
}

/**
 * Charges drifting along a wire: `count` glowing dots evenly spaced along the path, moving at
 * `speedRef.current` (or `speed`) path-units per second; a negative speed runs them backwards.
 * Used to show the electric current — faster dots = larger current.
 */
export function CurrentFlow({
  points,
  closed = false,
  count = 20,
  speed = 0,
  speedRef,
  color = "#7dd3fc",
  radius = 0.045,
}: {
  points: [number, number, number][];
  closed?: boolean;
  count?: number;
  speed?: number;
  speedRef?: RefObject<number>;
  color?: string;
  radius?: number;
}) {
  const curve = useMemo(() => wireCurve(points, closed), [points, closed]);
  const length = useMemo(() => curve.getLength(), [curve]);
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const offset = useRef(0);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const point = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const v = speedRef?.current ?? speed;
    offset.current = (((offset.current + (v * Math.min(delta, 0.05)) / length) % 1) + 1) % 1;
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < count; i++) {
      const u = (i / count + offset.current) % 1;
      curve.getPointAt(u, point);
      tmp.position.copy(point);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[radius, 10, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} toneMapped={false} />
    </instancedMesh>
  );
}

/** Desk multimeter: a box with a dial (DialGauge-like) face toward +z and a letter on it; `valueRef` 0..1 swings the needle. */
export function Meter({ letter = "V", value = 0, valueRef, ...group }: GroupProps & { letter?: string; value?: number; valueRef?: RefObject<number> }) {
  const needle = useRef<THREE.Group>(null!);
  const shown = useRef(value);
  const face = useMemo(() => textTexture(letter, { color: "#111827", background: "#f8fafc", font: "bold 64px sans-serif", width: 128, height: 128 }), [letter]);
  useFrame((_, dt) => {
    const target = THREE.MathUtils.clamp(valueRef?.current ?? value, 0, 1.05);
    shown.current += (target - shown.current) * Math.min(1, dt * 8);
    if (needle.current) needle.current.rotation.z = THREE.MathUtils.lerp(0.9, -0.9, shown.current);
  });
  return (
    <group {...group}>
      <mesh castShadow>
        <boxGeometry args={[0.55, 0.45, 0.2]} />
        <meshStandardMaterial color="#facc15" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.03, 0.101]}>
        <planeGeometry args={[0.44, 0.3]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.04, 0.103]}>
        <planeGeometry args={[0.12, 0.12]} />
        <meshStandardMaterial map={face} transparent />
      </mesh>
      {/* scale arc */}
      <mesh position={[0, -0.09, 0.103]}>
        <ringGeometry args={[0.2, 0.21, 24, 1, Math.PI / 2 - 0.9, 1.8]} />
        <meshBasicMaterial color="#111827" />
      </mesh>
      <group ref={needle} position={[0, -0.09, 0.106]}>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.012, 0.22, 0.004]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.15, -0.19, 0.11]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.04, 12]} />
          <meshStandardMaterial color={s < 0 ? "#111827" : "#dc2626"} />
        </mesh>
      ))}
    </group>
  );
}


function psuDisplay(volts: number) {
  const text = volts.toFixed(1);
  return canvasTexture(`psu-${text}`, 256, 96, (ctx, w, h) => {
    ctx.fillStyle = "#0b1410";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#4ade80";
    ctx.font = "bold 60px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w - 52, h / 2 + 2);
    ctx.font = "bold 40px sans-serif";
    ctx.fillText("V", w - 12, h / 2 + 4);
  });
}

/** Laboratory DC power supply standing on y = 0, front panel toward +z, with a display of `volts`. */
export function PowerSupply({ volts = 12, ...group }: GroupProps & { volts?: number }) {
  const display = useMemo(() => psuDisplay(volts), [volts]);
  return (
    <group {...group}>
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.56, 0.6]} />
        <meshStandardMaterial color="#e5e7eb" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.28, 0.301]}>
        <planeGeometry args={[0.94, 0.5]} />
        <meshStandardMaterial color="#334155" roughness={0.6} />
      </mesh>
      <mesh position={[-0.15, 0.4, 0.303]}>
        <planeGeometry args={[0.52, 0.19]} />
        <meshStandardMaterial map={display} emissive="#ffffff" emissiveMap={display} emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      <mesh position={[0.3, 0.4, 0.33]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.06, 20]} />
        <meshStandardMaterial color="#111827" roughness={0.4} />
      </mesh>
      {[PSU_PLUS, PSU_MINUS].map((p, i) => (
        <mesh key={i} position={[p[0], p[1], 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.05, 16]} />
          <meshStandardMaterial color={i === 0 ? "#dc2626" : "#111827"} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}


/**
 * School rheostat along x: a ceramic tube wound with resistance wire, a rail and a slider.
 * `fraction` (0..1) — how much of the winding is in the circuit (slider position);
 * `heat` (0..1.5) — glow of the working part of the winding.
 */
export function Rheostat({ fraction = 0.5, heat = 0, ...group }: GroupProps & { fraction?: number; heat?: number }) {
  const f = THREE.MathUtils.clamp(fraction, 0.02, 1);
  const sliderX = -0.75 + f * 1.5;
  const coil = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const turns = 46;
    const steps = turns * 16;
    for (let i = 0; i <= steps; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push(new THREE.Vector3(-0.75 + (i / steps) * 1.5, 0.32 + Math.sin(a) * 0.17, Math.cos(a) * 0.17));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, 0.011, 5, false);
  }, []);
  return (
    <group {...group}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.85, 0.3, 0]} castShadow>
          <boxGeometry args={[0.12, 0.6, 0.42]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.32, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 1.6, 24]} />
        <meshStandardMaterial color="#f5f0e6" roughness={0.8} />
      </mesh>
      <mesh geometry={coil}>
        <meshStandardMaterial color="#a8a29e" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* the working (current-carrying) part of the winding glows with heat */}
      <mesh position={[-0.75 + f * 0.75, 0.32, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, f, 1]}>
        <cylinderGeometry args={[0.185, 0.185, 1.5, 24, 1, true]} />
        <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={heat * 2} transparent opacity={0.15 + Math.min(heat, 1) * 0.45} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, 1.72, 10]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
      </mesh>
      {/* slider: a contact pressing on the winding and a black knob */}
      <group position={[sliderX, 0, 0]}>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[0.14, 0.12, 0.16]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.53, 0]}>
          <boxGeometry args={[0.03, 0.1, 0.05]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.74, 0]}>
          <cylinderGeometry args={[0.06, 0.07, 0.14, 16]} />
          <meshStandardMaterial color="#111827" roughness={0.4} />
        </mesh>
      </group>
      {[RHEO_LEFT, RHEO_RIGHT].map((p, i) => (
        <mesh key={i} position={p}>
          <cylinderGeometry args={[0.04, 0.04, 0.06, 12]} />
          <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** Socket for a `LightBulb`: a black block; contacts on its sides at (±0.16, 0.06, 0). The bulb goes on top at y = 0.12. */
export function BulbSocket(group: GroupProps) {
  return (
    <group {...group}>
      <mesh position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.32, 0.12, 0.3]} />
        <meshStandardMaterial color="#1f2937" roughness={0.6} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.16, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 0.04, 10]} />
          <meshStandardMaterial color="#b45309" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
