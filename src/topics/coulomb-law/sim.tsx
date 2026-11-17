import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { ChargedBall } from "@/components/sim/props/electric";
import { LabBench } from "@/components/sim/props/environment";
import { badgeTexture } from "@/components/sim/props/textures";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const K_COULOMB = 8.99e9;
const F_SCALE = 0.6;
const PERIOD = 6;

interface SamplePoint {
  t: number;
  r: number;
  F: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  r: number;
  F: number;
}

function rAt(t: number, rMin: number, rMax: number) {
  const mid = (rMin + rMax) / 2;
  const amp = (rMax - rMin) / 2;
  return mid - amp * Math.cos((2 * Math.PI * t) / PERIOD);
}

interface SceneContentProps {
  q1: number;
  q2: number;
  rMin: number;
  rMax: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ q1, q2, rMin, rMax, running, speed, onSample, onLive }: SceneContentProps) {
  const sphere1Ref = useRef<THREE.Group>(null!);
  const sphere2Ref = useRef<THREE.Group>(null!);
  const arrow1 = useRef<VectorArrowHandle>(null);
  const arrow2 = useRef<VectorArrowHandle>(null);

  const r1 = 0.2 + Math.min(Math.abs(q1) * 1e6 * 0.03, 0.25);
  const r2 = 0.2 + Math.min(Math.abs(q2) * 1e6 * 0.03, 0.25);

  const handleFrame = useCallback(
    (t: number) => {
      const r = rAt(t, rMin, rMax);
      const F = (K_COULOMB * q1 * q2) / (r * r);
      const x1 = -r / 2;
      const x2 = r / 2;
      const dirSign = F >= 0 ? 1 : -1;
      const mag = Math.min(Math.abs(F) * F_SCALE, 2.5);
      if (sphere1Ref.current) sphere1Ref.current.position.x = x1;
      if (sphere2Ref.current) sphere2Ref.current.position.x = x2;
      arrow1.current?.set([x1, 1.25, 0.05], [-dirSign * mag, 0, 0]);
      arrow2.current?.set([x2, 1.25, 0.05], [dirSign * mag, 0, 0]);
    },
    [q1, q2, rMin, rMax],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const r = rAt(t, rMin, rMax);
          const F = (K_COULOMB * q1 * q2) / (r * r);
          onSample({ t, r, F });
          onLive({ t, r, F });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={8} depth={3} height={0.9} />
      {/* metal balls on insulating glass stands; the stands slide on a rail */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[7.5, 0.04, 0.3]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.35} />
      </mesh>
      {[
        { ref: sphere1Ref, x: -((rMin + rMax) / 2) / 2, r: r1, q: q1, name: "шарик 1" },
        { ref: sphere2Ref, x: ((rMin + rMax) / 2) / 2, r: r2, q: q2, name: "шарик 2" },
      ].map((b) => (
        <group key={b.name} ref={b.ref} position={[b.x, 0, 0]}>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.22, 0.25, 0.08, 20]} />
            <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.45, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.8, 10]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.55} roughness={0.05} />
          </mesh>
          <ChargedBall position={[0, 0.85 + b.r * 0.5, 0]} sign={b.q >= 0 ? 1 : -1} radius={b.r} color={b.q >= 0 ? "#dc2626" : "#2563eb"} />
          <SceneLabel position={[0, 1.55 + b.r, 0]}>{`${b.name}: ${(b.q * 1e6).toFixed(1)} мкКл`}</SceneLabel>
        </group>
      ))}
      <VectorArrow ref={arrow1} color="#fbbf24" />
      <VectorArrow ref={arrow2} color="#fbbf24" />
    </>
  );
}

const N_PAPERS = 8;
const K_SCALE = 3e-11; // scales real Coulomb force into a visually workable acceleration
const Q_PAPER = -2e-9;

interface Paper {
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
}

function SceneBalloon({ qBalloon, running, speed }: { qBalloon: number; running: boolean; speed: number }) {
  const papersRef = useRef<Paper[]>(
    Array.from({ length: N_PAPERS }, (_, i) => {
      const a = (i / N_PAPERS) * Math.PI * 2;
      const r = 1.4 + Math.random() * 0.6;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, vx: 0, vz: 0, angle: Math.random() * Math.PI };
    }),
  );
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  const handleFrame = useCallback(
    (_t: number, dt: number) => {
      for (let i = 0; i < papersRef.current.length; i++) {
        const p = papersRef.current[i];
        const dx = 0 - p.x;
        const dz = 0.5 - p.z;
        const dist = Math.max(Math.hypot(dx, dz), 0.3);
        const F = (K_COULOMB * qBalloon * Q_PAPER) / (dist * dist);
        const ax = (F / dist) * dx * K_SCALE;
        const az = (F / dist) * dz * K_SCALE;
        p.vx += ax * dt;
        p.vz += az * dt;
        p.vx *= 0.98;
        p.vz *= 0.98;
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        if (dist <= 0.35) {
          p.vx = 0;
          p.vz = 0;
        }
        const m = meshRefs.current[i];
        if (m) {
          m.position.set(p.x, 0.4, p.z);
          m.rotation.y += dt * 2;
        }
      }
    },
    [qBalloon],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />

      <group position={[0, 0.95, 0.5]}>
        <mesh scale={[1, 1.15, 1]} castShadow>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial color="#ef4444" roughness={0.25} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.62, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.06, 0.1, 12]} />
          <meshStandardMaterial color="#b91c1c" />
        </mesh>
        <mesh position={[0, 1.4, 0]}>
          <cylinderGeometry args={[0.005, 0.005, 1.5, 4]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
        <sprite position={[0, 0, 0.55]} scale={0.32}>
          <spriteMaterial map={badgeTexture("−", "#2563eb")} transparent />
        </sprite>
        <SceneLabel position={[0, 0.85, 0]}>шарик натёрли о волосы — он заряжен</SceneLabel>
      </group>
      <LabBench position={[0, -0.9, 0]} length={8} depth={4} height={0.9} />

      {Array.from({ length: N_PAPERS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m;
          }}
          castShadow
        >
          <boxGeometry args={[0.16, 0.004, 0.11]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <SceneLabel position={[2, 0.5, 1]}>бумажки</SceneLabel>
    </>
  );
}

export function CoulombLawSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, q1, q2, rMin, rMax, qBalloon } = useControls("Закон Кулона", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Два заряженных шарика": "abstract", "Шарик и бумажки": "balloon" },
    },
    q1: { value: 4, min: -8, max: 8, step: 0.5, label: "q₁, мкКл", render: (get) => get("Закон Кулона.scenario") === "abstract" },
    q2: { value: -3, min: -8, max: 8, step: 0.5, label: "q₂, мкКл", render: (get) => get("Закон Кулона.scenario") === "abstract" },
    rMin: { value: 0.8, min: 0.4, max: 2, step: 0.1, label: "r мин, м", render: (get) => get("Закон Кулона.scenario") === "abstract" },
    rMax: { value: 3, min: 2, max: 4, step: 0.1, label: "r макс, м", render: (get) => get("Закон Кулона.scenario") === "abstract" },
    qBalloon: { value: 60, min: 20, max: 150, step: 10, label: "заряд шарика, нКл", render: (get) => get("Закон Кулона.scenario") === "balloon" },
  });
  const balloon = scenario === "balloon";

  const q1c = q1 * 1e-6;
  const q2c = q2 * 1e-6;

  const curve = useMemo(() => {
    const pts: { r: number; F: number }[] = [];
    for (let i = 0; i <= 50; i++) {
      const rr = 0.4 + (4 - 0.4) * (i / 50);
      const f = (K_COULOMB * q1c * q2c) / (rr * rr);
      pts.push({ r: Number(rr.toFixed(2)), F: Number(f.toFixed(4)) });
    }
    return pts;
  }, [q1c, q2c]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, r: rMin, F: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, r: rMin, F: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, r: rMin, F: 0 });
    setSeries([{ t: 0, r: rMin, F: 0 }]);
  }, [rMin]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const attract = q1 * q2 < 0;
  const caption = balloon ? (
    <>
      Резиновый шарик натёрли о волосы — на него перешли лишние электроны. Заряд притягивает лёгкие <b>бумажки</b>: в них заряды смещаются (ближняя сторона заряжается противоположно), и
      бумажки подпрыгивают к шарику, хотя сами не заряжены.
    </>
  ) : (
    <>
      Шарики {attract ? <b>притягиваются</b> : <b>отталкиваются</b>} ({attract ? "разноимённые заряды" : "одноимённые заряды"}). Сила F = k·q₁q₂/r² = {Math.abs(live.F).toFixed(3).replace(".", ",")} Н при r ={" "}
      {live.r.toFixed(2).replace(".", ",")} м: уменьшите расстояние вдвое — сила вырастет в 4 раза. Стрелки одинаковые — третий закон Ньютона.
    </>
  );
  const legend: LegendItem[] = balloon
    ? []
    : [
        { color: "#f87171", label: "сила Кулона" },
        { color: "#dc2626", label: "+ заряд", kind: "dot" },
        { color: "#2563eb", label: "− заряд", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [0, 2.6, 6.5], fov: 50 }} orbitTarget={[0, 0.7, 0]} simplified={isMobile} maxDistance={18} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          {balloon ? (
            <SceneBalloon key={clock.resetNonce} qBalloon={qBalloon * 1e-9} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} q1={q1c} q2={q2c} rMin={rMin} rMax={rMax} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        balloon ? (
          <NumberReadouts
            items={[
              { label: "Заряд шарика", value: qBalloon.toFixed(0), unit: "нКл" },
              { label: "F на бумажку (r=0.5м)", value: ((K_COULOMB * qBalloon * 1e-9 * 2e-9) / 0.25).toExponential(2), unit: "Н" },
              { label: "Характер", value: "притяжение (индуцированный заряд)" },
              { label: "k (постоянная Кулона)", value: "8.99×10⁹", unit: "Н·м²/Кл²" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "r(t)", value: live.r.toFixed(2), unit: "м" },
              { label: "F = k·q₁q₂/r²", value: live.F.toFixed(4), unit: "Н", color: live.F >= 0 ? "#f87171" : "#38bdf8" },
              { label: "Характер", value: live.F >= 0 ? "отталкивание" : "притяжение" },
              { label: "k (постоянная Кулона)", value: "8.99×10⁹", unit: "Н·м²/Кл²" },
            ]}
          />
        )
      }
      graphs={
        balloon ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Каждая бумажка притягивается к шарику своей собственной силой Кулона — суммарная картина движения
            всех бумажек одновременно и есть иллюстрация принципа суперпозиции: результирующая сила на любое
            тело складывается из сил от каждого источника заряда по отдельности.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">F(r) — убывание как 1/r²</p>
              <LiveChart data={curve} xKey="r" xType="number" xLabel="r, м" series={[{ key: "F", color: "#fbbf24", label: "F, Н" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">F(t) при периодическом сближении/удалении зарядов</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "F", color: "#fbbf24", label: "F, Н" }]} />
            </div>
          </div>
        )
      }
      note={
        balloon ? (
          <>
            Потерев шарик о волосы, вы переносите на него электроны — он заряжается и притягивает лёгкие
            незаряженные бумажки за счёт поляризации (наведённого разделения зарядов внутри бумаги), а дальше
            работает обычный закон Кулона F=kq₁q₂/r². Чем ближе бумажка, тем сильнее притяжение — оно растёт
            как 1/r².
          </>
        ) : (
          <>
            Сила Кулона F=kq₁q₂/r² убывает обратно пропорционально квадрату расстояния — заряды медленно
            сближаются и расходятся, показывая рост и спад силы. Одноимённые заряды отталкиваются, разноимённые
            притягиваются; жёлтые стрелки — сила, действующая на каждый заряд (третий закон Ньютона).
          </>
        )
      }
    />
  );
}
