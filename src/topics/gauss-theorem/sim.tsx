import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { ChargedBall, Phone, VanDeGraaff } from "@/components/sim/props/electric";
import { Ground } from "@/components/sim/props/environment";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const K_COULOMB = 8.99e9;
const EPS0 = 8.854e-12;
const PERIOD = 6;
const FIXED_RADII = [1.1, 1.9, 2.7];
const RINGS = 10;

interface SamplePoint {
  t: number;
  R: number;
  E: number;
  Phi: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  R: number;
  E: number;
  Phi: number;
}

function rAt(t: number, rMin: number, rMax: number) {
  const mid = (rMin + rMax) / 2;
  const amp = (rMax - rMin) / 2;
  return mid - amp * Math.cos((2 * Math.PI * t) / PERIOD);
}

function FieldRings({ q }: { q: number }) {
  const arrows = useMemo(() => {
    const list: { origin: [number, number, number]; vector: [number, number, number] }[] = [];
    for (const R of FIXED_RADII) {
      const E = (K_COULOMB * q) / (R * R);
      for (let i = 0; i < RINGS; i++) {
        const a = (i / RINGS) * Math.PI * 2;
        const ox = R * Math.cos(a);
        const oz = R * Math.sin(a);
        const dirSign = q >= 0 ? 1 : -1;
        const scale = Math.min(Math.abs(E) * 4e-10, 0.9) * dirSign;
        list.push({ origin: [ox, 0.4, oz], vector: [Math.cos(a) * scale, 0, Math.sin(a) * scale] });
      }
    }
    return list;
  }, [q]);

  return (
    <>
      {arrows.map((a, i) => (
        <FieldArrow key={i} origin={a.origin} vector={a.vector} color="#5eead4" opacity={0.85} />
      ))}
    </>
  );
}

interface SceneContentProps {
  q: number;
  rMin: number;
  rMax: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ q, rMin, rMax, running, speed, onSample, onLive }: SceneContentProps) {
  const sphereRef = useRef<THREE.Mesh>(null!);

  const handleFrame = useCallback(
    (t: number) => {
      const R = rAt(t, rMin, rMax);
      if (sphereRef.current) sphereRef.current.scale.setScalar(R);
    },
    [rMin, rMax],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const R = rAt(t, rMin, rMax);
          const E = (K_COULOMB * q) / (R * R);
          const Phi = q / EPS0;
          onSample({ t, R, E, Phi });
          onLive({ t, R, E, Phi });
        }}
      />

      <ChargedBall position={[0, 0.4, 0]} sign={1} radius={0.2} />
      <SceneLabel position={[0, 0.85, 0]}>заряд q</SceneLabel>

      <mesh ref={sphereRef} position={[0, 0.4, 0]}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshBasicMaterial color="#fbbf24" wireframe transparent opacity={0.35} />
        <SceneLabel position={[0, 1.3, 0]}>воображаемая сфера Гаусса</SceneLabel>
      </mesh>

      <FieldRings q={q} />

      <Ground kind="tiles" from={-6} to={6} width={10} tile={2} tileZ={2} y={-0.02} />
    </>
  );
}

const CAGE_R = 1.3;

interface CageLive {
  t: number;
  eOutside: number;
  eInside: number;
}

function SceneCage({ q, dist, running, speed, onLive }: { q: number; dist: number; running: boolean; speed: number; onLive: (n: CageLive) => void }) {
  const chargeRef = useRef<THREE.Group>(null!);

  const eOutside = (K_COULOMB * q) / ((dist - CAGE_R) * (dist - CAGE_R));

  const handleFrame = useCallback(() => {
    if (chargeRef.current) chargeRef.current.position.set(dist, 0, 0);
  }, [dist]);

  const outsideArrows = useMemo(() => {
    const list: { origin: [number, number, number]; vector: [number, number, number] }[] = [];
    const shellR = CAGE_R + 0.5;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const ox = shellR * Math.cos(a);
      const oz = shellR * Math.sin(a);
      const dx = ox - dist;
      const dz = oz;
      const r = Math.max(Math.hypot(dx, dz), 0.5);
      const E = (K_COULOMB * q) / (r * r);
      const scale = Math.min(Math.abs(E) * 3e-10, 0.6);
      list.push({ origin: [ox, 0.4, oz], vector: [(dx / r) * scale, 0, (dz / r) * scale] });
    }
    return list;
  }, [q, dist]);

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={20} onSample={(t) => onLive({ t, eOutside, eInside: 0 })} />

      {/* metal-mesh cage: wire sphere with a solid ring and a base */}
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[CAGE_R, 20, 14]} />
        <meshStandardMaterial color="#d4d4d8" wireframe metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[CAGE_R, 0.03, 8, 48]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.4 - CAGE_R - 0.04, 0]}>
        <cylinderGeometry args={[0.6, 0.7, 0.08, 24]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
      </mesh>
      <SceneLabel position={[0, CAGE_R + 0.75, 0]}>клетка Фарадея (металлическая сетка)</SceneLabel>

      <Phone position={[0, 0.4, 0]} signal={false} />
      <SceneLabel position={[0, 0.95, 0.3]}>телефон внутри: поле = 0, сети нет</SceneLabel>

      <group ref={chargeRef} position={[dist, 0, 0]}>
        <VanDeGraaff position={[0, 0.4 - CAGE_R - 0.08, 0]} height={CAGE_R + 0.5} dome={0.32} />
        <SceneLabel position={[0, 1.2, 0]}>заряженный генератор (внешний заряд)</SceneLabel>
      </group>

      {outsideArrows.map((a, i) => (
        <FieldArrow key={i} origin={a.origin} vector={a.vector} color="#5eead4" opacity={0.85} />
      ))}

      <Ground kind="tiles" from={-6} to={6} width={10} tile={2} tileZ={2} y={0.4 - CAGE_R - 0.08} />
    </>
  );
}

export function GaussTheoremSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, qMicro, rMin, rMax, cageDist } = useControls("Теорема Гаусса", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Заряд в поверхности Гаусса": "abstract", "Клетка Фарадея": "cage" },
    },
    qMicro: { value: 5, min: 1, max: 10, step: 0.5, label: "q, мкКл", render: (get) => get("Теорема Гаусса.scenario") === "abstract" },
    rMin: { value: 0.8, min: 0.5, max: 1.5, step: 0.1, label: "R мин, м", render: (get) => get("Теорема Гаусса.scenario") === "abstract" },
    rMax: { value: 3, min: 2, max: 4, step: 0.1, label: "R макс, м", render: (get) => get("Теорема Гаусса.scenario") === "abstract" },
    cageDist: { value: 2.5, min: 2, max: 4, step: 0.1, label: "расстояние до заряда, м", render: (get) => get("Теорема Гаусса.scenario") === "cage" },
  });
  const cage = scenario === "cage";
  const q = qMicro * 1e-6;
  const [cageLive, setCageLive] = useState<CageLive>({ t: 0, eOutside: 0, eInside: 0 });

  const curve = useMemo(() => {
    const pts: { R: number; E: number; Phi: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const R = rMin * 0.9 + (rMax * 1.1 - rMin * 0.9) * (i / 40);
      const E = (K_COULOMB * q) / (R * R);
      pts.push({ R: Number(R.toFixed(2)), E: Number((E / 1e6).toFixed(3)), Phi: Number((q / EPS0 / 1e6).toFixed(3)) });
    }
    return pts;
  }, [q, rMin, rMax]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, R: rMin, E: 0, Phi: q / EPS0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, R: rMin, E: 0, Phi: q / EPS0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, R: rMin, E: 0, Phi: q / EPS0 });
    setSeries([{ t: 0, R: rMin, E: 0, Phi: q / EPS0 }]);
  }, [rMin, q]);

  const caption = cage ? (
    <>
      Снаружи стоит заряженный генератор, его поле (бирюзовые стрелки) сильное. Но электроны в металлической сетке перебегают так, что <b>внутри клетки поле ровно ноль</b> — телефон там
      теряет сеть. Так экранируют приборы, а в металлическом лифте связь пропадает по той же причине.
    </>
  ) : (
    <>
      Воображаемая сфера вокруг заряда то раздувается, то сжимается. Поле на ней меняется (E ∝ 1/R²), площадь тоже (∝ R²) — а <b>поток Φ = E·S остаётся одинаковым</b>: q/ε₀. Это и есть теорема
      Гаусса: поток зависит только от заряда внутри.
    </>
  );
  const legend: LegendItem[] = [{ color: "#5eead4", label: "напряжённость поля E" }];

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [0.8, 4, 7.5], fov: 50 }} orbitTarget={[cage ? 0.8 : 0, 0.4, 0]} simplified={isMobile} maxDistance={22} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          {cage ? (
            <SceneCage key={clock.resetNonce} q={q} dist={cageDist} running={clock.running} speed={clock.speed} onLive={setCageLive} />
          ) : (
            <SceneContent key={clock.resetNonce} q={q} rMin={rMin} rMax={rMax} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        cage ? (
          <NumberReadouts
            items={[
              { label: "E снаружи клетки", value: cageLive.eOutside.toExponential(2), unit: "В/м", color: "#5eead4" },
              { label: "E внутри клетки", value: "0", unit: "В/м", color: "#4ade80" },
              { label: "Заряд, наведённый на клетке", value: "перераспределяется по поверхности" },
              { label: "Сигнал внутри", value: "экранирован" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "R(t) сферы Гаусса", value: live.R.toFixed(2), unit: "м" },
              { label: "E(R) = kq/R²", value: (live.E / 1e6).toFixed(3), unit: "МВ/м" },
              { label: "Поток Φ = q/ε₀", value: (live.Phi / 1e6).toFixed(3), unit: "МВ·м" },
              { label: "Постоянство потока", value: "не зависит от R" },
            ]}
          />
        )
      }
      graphs={
        cage ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Для любой гауссовой поверхности ВНУТРИ проводящей клетки заключённый заряд равен нулю (заряды
            проводника экранируют его целиком, оставаясь на внешней поверхности) — значит и поток, и поле
            внутри тождественно равны нулю, независимо от того, насколько силён внешний заряд.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">E(R) убывает, Φ(R) остаётся постоянным</p>
              <LiveChart data={curve} xKey="R" xType="number" xLabel="R, м" series={[{ key: "E", color: "#5eead4", label: "E, МВ/м" }, { key: "Phi", color: "#fbbf24", label: "Φ, МВ·м" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">E(t) и Φ(t) при пульсации сферы Гаусса</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "E", color: "#5eead4", label: "E, В/м" }, { key: "Phi", color: "#fbbf24", label: "Φ, В·м" }]} />
            </div>
          </div>
        )
      }
      note={
        cage ? (
          <>
            Заряд снаружи наводит на проводящей оболочке клетки Фарадея противоположные поверхностные заряды,
            которые полностью компенсируют внешнее поле внутри полости — телефон внутри клетки не ловит сигнал,
            а человек внутри автомобиля или самолёта защищён от удара молнии именно по этому принципу.
          </>
        ) : (
          <>
            Жёлтая сфера — воображаемая гауссова поверхность радиуса R(t), периодически расширяется и
            сжимается вокруг заряда. Напряжённость поля E=kq/R² на её поверхности убывает с ростом R, но поток
            через всю поверхность Φ=∮E·dA=q/ε₀ не зависит от R — теорема Гаусса: поток определяется только
            заключённым зарядом.
          </>
        )
      }
    />
  );
}
