import { useCallback, useMemo, useRef } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LabBench } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const A_V = 15.8;
const A_S = 18.3;
const A_C = 0.714;
const A_A = 23.2;

const SYMBOLS =
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U".split(
    " ",
  );

function bindingEnergy(A: number, Z: number) {
  const N = A - Z;
  if (A < 1 || Z < 0 || N < 0) return 0;
  const vol = A_V * A;
  const surf = A_S * Math.pow(A, 2 / 3);
  const coul = (A_C * Z * (Z - 1)) / Math.pow(A, 1 / 3);
  const asym = (A_A * Math.pow(A - 2 * Z, 2)) / A;
  let pairing = 0;
  const evenZ = Z % 2 === 0;
  const evenN = N % 2 === 0;
  if (evenZ && evenN) pairing = 12 / Math.sqrt(A);
  else if (!evenZ && !evenN) pairing = -12 / Math.sqrt(A);
  return Math.max(vol - surf - coul - asym + pairing, 0);
}

function bestZ(A: number) {
  let best = 1;
  let bestBE = 0;
  for (let Z = 1; Z < A; Z++) {
    const be = bindingEnergy(A, Z);
    if (be > bestBE) {
      bestBE = be;
      best = Z;
    }
  }
  return best;
}

function nucleonCloud(A: number, Z: number, maxN: number, scale: number) {
  const n = Math.min(A, maxN);
  const radius = (0.3 + 0.28 * Math.cbrt(n)) * scale;
  let s = A * 7919 + Z * 104729;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const pts: { x: number; y: number; z: number; proton: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = radius * Math.cbrt(rand());
    const s2 = Math.sqrt(1 - u * u);
    pts.push({ x: r * s2 * Math.cos(theta), y: r * s2 * Math.sin(theta), z: r * u, proton: i < (Z / A) * n });
  }
  return pts;
}

interface SceneContentProps {
  A: number;
  Z: number;
  beA: number;
  running: boolean;
  speed: number;
}

const BEAM_Y = 2.2;
const PAN_DROP = 1.0;
const ARM = 1.1;

function SceneContent({ A, Z, beA, running, speed }: SceneContentProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const beam = useRef<THREE.Group>(null!);
  const leftPan = useRef<THREE.Group>(null!);
  const rightPan = useRef<THREE.Group>(null!);
  const nucleons = useMemo(() => nucleonCloud(A, Z, 120, 1), [A, Z]);
  const small = useMemo(() => nucleonCloud(A, Z, 60, 0.42), [A, Z]);
  // separated nucleons lie in a heap on the other pan
  const heap = useMemo(() => {
    const n = Math.min(A, 60);
    return Array.from({ length: n }, (_, i) => {
      const ring = Math.floor(Math.sqrt(i));
      const a = i * 2.39996;
      return { x: Math.cos(a) * 0.06 * ring, z: Math.sin(a) * 0.06 * ring, y: 0.05 + (i % 3) * 0.035, proton: i < (Z / A) * n };
    });
  }, [A, Z]);
  // the beam tips toward the heavier side: the free nucleons (tilt exaggerated ×1000)
  const tilt = -THREE.MathUtils.degToRad(Math.min(beA, 9) * 1.1);

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      if (groupRef.current) groupRef.current.rotation.y += 0.15 * dt;
      const settle = tilt * (1 - Math.exp(-t * 1.5)) + Math.sin(t * 3) * Math.exp(-t * 1.2) * 0.04;
      if (beam.current) beam.current.rotation.z = settle;
      // the pans stay level, hanging from the ends of the beam
      if (leftPan.current) leftPan.current.position.set(1.6 - ARM * Math.cos(settle), BEAM_Y - ARM * Math.sin(settle) - PAN_DROP, 0);
      if (rightPan.current) rightPan.current.position.set(1.6 + ARM * Math.cos(settle), BEAM_Y + ARM * Math.sin(settle) - PAN_DROP, 0);
    },
    [tilt],
  );

  const symbol = SYMBOLS[Z - 1] ?? "?";
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0.4, -0.9, 0]} length={6} depth={2.4} height={0.9} />

      {/* the nucleus, magnified ~10¹⁴ times */}
      <group ref={groupRef} position={[-1.6, 1.6, 0]}>
        {nucleons.map((p, i) => (
          <mesh key={i} position={[p.x, p.y, p.z]}>
            <sphereGeometry args={[0.12, 10, 10]} />
            <meshStandardMaterial color={p.proton ? "#ef4444" : "#a1a1aa"} emissive={p.proton ? "#ef4444" : "#52525b"} emissiveIntensity={0.35} roughness={0.4} />
          </mesh>
        ))}
      </group>
      <SceneLabel position={[-1.6, 3.15, 0]}>{`ядро ${symbol}-${A}: ${Z} протонов + ${A - Z} нейтронов`}</SceneLabel>

      {/* balance: the nucleus vs the same nucleons taken apart */}
      <group position={[1.6, 0, 0]}>
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[0.9, 0.12, 0.6]} />
          <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, BEAM_Y / 2, 0]}>
          <cylinderGeometry args={[0.05, 0.07, BEAM_Y, 12]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
      <group ref={beam} position={[1.6, BEAM_Y, 0]}>
        <mesh>
          <boxGeometry args={[2 * ARM + 0.1, 0.06, 0.08]} />
          <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.25, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.04, 0.4, 8]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
      {[leftPan, rightPan].map((ref, side) => (
        <group key={side} ref={ref} position={[1.6 + (side ? ARM : -ARM), BEAM_Y - PAN_DROP, 0]}>
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2;
            return (
              <mesh key={k} position={[Math.cos(a) * 0.18, PAN_DROP / 2, Math.sin(a) * 0.18]} rotation={[Math.sin(a) * 0.17, 0, -Math.cos(a) * 0.17]}>
                <cylinderGeometry args={[0.005, 0.005, PAN_DROP, 4]} />
                <meshStandardMaterial color="#cbd5e1" />
              </mesh>
            );
          })}
          <mesh>
            <cylinderGeometry args={[0.42, 0.36, 0.05, 28]} />
            <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.3} />
          </mesh>
          {side === 0 ? (
            <group position={[0, 0.3, 0]}>
              {small.map((p, i) => (
                <mesh key={i} position={[p.x, p.y, p.z]}>
                  <sphereGeometry args={[0.05, 8, 6]} />
                  <meshStandardMaterial color={p.proton ? "#ef4444" : "#a1a1aa"} />
                </mesh>
              ))}
            </group>
          ) : (
            heap.map((p, i) => (
              <mesh key={i} position={[p.x, p.y, p.z]}>
                <sphereGeometry args={[0.05, 8, 6]} />
                <meshStandardMaterial color={p.proton ? "#ef4444" : "#a1a1aa"} />
              </mesh>
            ))
          )}
        </group>
      ))}
      <SceneLabel position={[1.6 - ARM, 0.5, 0.6]}>ядро целиком</SceneLabel>
      <SceneLabel position={[1.6 + ARM, 0.5, 0.6]}>те же частицы по отдельности</SceneLabel>
    </>
  );
}

export function NucleusBindingEnergySim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { A, Z } = useControls("Энергия связи ядра", {
    A: { value: 56, min: 4, max: 238, step: 1, label: "A (массовое число)" },
    Z: { value: 26, min: 1, max: 92, step: 1, label: "Z (число протонов)" },
  });
  const Zc = Math.min(Z, A - 1);

  const BE = bindingEnergy(A, Zc);
  const beA = BE / A;
  const massDefectU = BE / 931.494;

  const curve = useMemo(() => {
    const pts: { A: number; beA: number }[] = [];
    for (let a = 4; a <= 238; a += 4) {
      const z = bestZ(a);
      pts.push({ A: a, beA: Number((bindingEnergy(a, z) / a).toFixed(3)) });
    }
    return pts;
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const symbol = SYMBOLS[Zc - 1] ?? "?";
  const caption = (
    <>
      Удивительно, но ядро {symbol}-{A} <b>легче</b>, чем его {A} частиц по отдельности, — весы перевешивают в сторону россыпи (на {fmt(massDefectU, 3)} а.е.м.). Эта «пропавшая» масса — энергия связи E = Δm·c² ={" "}
      {fmt(BE, 0)} МэВ: столько нужно затратить, чтобы разобрать ядро. На один нуклон — {fmt(beA, 2)} МэВ{beA > 8.6 ? ", почти рекорд (как у железа)" : ""}.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#ef4444", label: "протоны", kind: "dot" },
    { color: "#a1a1aa", label: "нейтроны", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas camera={{ position: [0.4, 2.6, 6.2] as [number, number, number], fov: 50 }} orbitTarget={[0.2, 1.6, 0]} simplified={isMobile} maxDistance={14} minDistance={2} bloomThreshold={0.8} fogRange={[14, 40]}>
          <SceneContent key={`${clock.resetNonce}-${A}-${Zc}`} A={A} Z={Zc} beA={beA} running={clock.running} speed={clock.speed} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: "A (нуклонов)", value: A.toString() },
            { label: "Z (протонов) / N (нейтронов)", value: `${Zc} / ${A - Zc}` },
            { label: "Энергия связи BE (Вайцзеккер)", value: BE.toFixed(1), unit: "МэВ" },
            { label: "BE/A (удельная)", value: beA.toFixed(3), unit: "МэВ/нуклон" },
            { label: "Дефект массы Δm=BE/c²", value: massDefectU.toFixed(4), unit: "а.е.м." },
          ]}
        />
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">BE/A(A) — пик стабильности у железа</p>
          <LiveChart data={curve} xKey="A" xType="number" xLabel="A" series={[{ key: "beA", color: "#4ade80", label: "BE/A, МэВ" }]} />
          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-2">
            <span>← <span className="text-cyan-400 font-medium">синтез (слева от Fe)</span>: лёгкие ядра сливаются, BE/A растёт</span>
            <span><span className="text-orange-400 font-medium">деление (справа от Fe)</span>: тяжёлые ядра распадаются, BE/A растёт →</span>
          </div>
        </div>
      }
      note={
        <>
          Полуэмпирическая формула Вайцзеккера BE=aᵥA−aₛA^⅔−a_cZ(Z−1)/A^⅓−a_a(A−2Z)²/A±δ точно
          воспроизводит кривую удельной энергии связи с максимумом у железа (A≈56, BE/A≈8.8 МэВ) — самые
          прочно связанные ядра. Левее железа выгоден синтез (слияние лёгких ядер поднимает BE/A) — именно
          так Солнце превращает водород в гелий. Правее железа выгодно деление — на этом основаны атомные
          электростанции. В обоих случаях освобождается энергия E=Δmc². На весах разница масс (около 1 %)
          сильно преувеличена, чтобы её было видно.
        </>
      }
    />
  );
}
