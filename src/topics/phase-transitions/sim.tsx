import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { ParticleInstances, type ParticleInstancesHandle } from "@/components/sim/ParticleInstances";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { initParticles, stepParticles, type GasParticle, type Bounds } from "@/lib/particleGas";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Burner, GlassVessel, Steam, Thermometer } from "@/components/sim/props/thermo";
import { Ground, LabBench } from "@/components/sim/props/environment";

const RADIUS = 0.07;
const Y_LEVEL = 0.6;
const L_FULL = 4;
const L_SOLID = 1.6;
const N_PARTICLES = 70;

const WATER = { Tm: 273, Tb0: 373.15, cSolid: 2100, cLiquid: 4186, cGas: 2000, Lf: 334000, Lv: 2260000 };
const P0_ATM = 101325;
const R_GAS = 8.314;
const M_WATER = 0.018;
const SOLID_BOUNDS: Bounds = { xMin: -L_SOLID / 2, xMax: L_SOLID / 2, zMin: -L_SOLID / 2, zMax: L_SOLID / 2 };
const FULL_BOUNDS: Bounds = { xMin: -L_FULL / 2, xMax: L_FULL / 2, zMin: -L_FULL / 2, zMax: L_FULL / 2 };

/** Clausius–Clapeyron: boiling point at atmospheric pressure Patm (Pa). */
function boilingPointAt(Patm: number) {
  const Lmolar = WATER.Lv * M_WATER;
  const invT = 1 / WATER.Tb0 - (R_GAS / Lmolar) * Math.log(Patm / P0_ATM);
  return 1 / invT;
}

/** Simple barometric formula, scale height ≈8000 m. */
function pressureAtAltitude(h: number) {
  return P0_ATM * Math.exp(-h / 8000);
}

interface Boundaries {
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

function computeBoundaries(m: number, P: number, Tstart: number, Tb: number) {
  const E1 = m * WATER.cSolid * (WATER.Tm - Tstart);
  const E2 = m * WATER.Lf;
  const E3 = m * WATER.cLiquid * (Tb - WATER.Tm);
  const E4 = m * WATER.Lv;
  const t1 = E1 / P;
  const t2 = t1 + E2 / P;
  const t3 = t2 + E3 / P;
  const t4 = t3 + E4 / P;
  return { t1, t2, t3, t4 };
}

function tempAt(t: number, b: Boundaries, m: number, P: number, Tstart: number, Tb: number) {
  if (t < b.t1) return { T: Tstart + (P * t) / (m * WATER.cSolid), phase: 0 };
  if (t < b.t2) return { T: WATER.Tm, phase: 1 };
  if (t < b.t3) return { T: WATER.Tm + (P * (t - b.t2)) / (m * WATER.cLiquid), phase: 2 };
  if (t < b.t4) return { T: Tb, phase: 3 };
  return { T: Tb + (P * (t - b.t4)) / (m * WATER.cGas), phase: 4 };
}

const PHASE_NAMES = ["нагрев льда", "плавление (лёд→вода)", "нагрев воды", "кипение (вода→пар)", "нагрев пара"];

interface LiveNumbers {
  t: number;
  T: number;
  phase: number;
}

interface SceneContentProps {
  b: Boundaries;
  m: number;
  P: number;
  Tstart: number;
  Tb: number;
  altitude?: number;
  running: boolean;
  speed: number;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ b, m, P, Tstart, Tb, altitude, running, speed, onLive }: SceneContentProps) {
  const particlesRef = useRef<GasParticle[]>(initParticles(N_PARTICLES, SOLID_BOUNDS, 0.15, RADIUS));
  const lastPhaseRef = useRef(0);
  const instHandle = useRef<ParticleInstancesHandle>(null);

  const handleFixedStep = useCallback(
    (dt: number, simTime: number) => {
      const { phase } = tempAt(simTime, b, m, P, Tstart, Tb);
      const bounds = phase === 0 ? SOLID_BOUNDS : FULL_BOUNDS;
      if (phase !== lastPhaseRef.current) {
        const boost = phase === 1 ? 1 : phase === 2 ? 1.8 : phase === 3 ? 1 : 2.4;
        if (phase > lastPhaseRef.current) {
          for (const p of particlesRef.current) {
            p.vx *= boost;
            p.vz *= boost;
          }
        }
        lastPhaseRef.current = phase;
      }
      stepParticles(particlesRef.current, dt, bounds, { pairwise: phase !== 0 });
    },
    [b, m, P, Tstart, Tb],
  );

  const ice = useRef<THREE.Mesh>(null!);
  const water = useRef<THREE.Mesh>(null!);
  const steam = useRef<THREE.Group>(null!);
  const plate = useRef<THREE.MeshStandardMaterial>(null!);
  const thermo = useRef(0.2);
  const tRef = useRef(0);

  const handleFrame = useCallback(
    (t: number) => {
      tRef.current = t;
      instHandle.current?.sync(particlesRef.current, Y_LEVEL, () => "#7ee8fa");
      const { T, phase } = tempAt(t, b, m, P, Tstart, Tb);
      thermo.current = Math.max(0.04, Math.min(1, (T - 230) / 200));
      // ice block shrinks while melting, the water layer appears, then boils away
      const meltFrac = phase === 0 ? 0 : phase === 1 ? (t - b.t1) / Math.max(1e-6, b.t2 - b.t1) : 1;
      const boilFrac = phase < 3 ? 0 : phase === 3 ? (t - b.t3) / Math.max(1e-6, b.t4 - b.t3) : 1;
      if (ice.current) {
        ice.current.visible = meltFrac < 0.999;
        ice.current.scale.set(1 - 0.85 * meltFrac, 1 - 0.85 * meltFrac, 1 - 0.85 * meltFrac);
      }
      if (water.current) {
        const level = Math.max(0.001, Math.min(1, meltFrac) * (1 - 0.9 * boilFrac));
        water.current.visible = meltFrac > 0.01 && level > 0.02;
        water.current.scale.y = level;
        water.current.position.y = Y_LEVEL - 0.25 + (0.42 * level) / 2;
      }
      if (steam.current) steam.current.visible = phase >= 3;
      if (plate.current) plate.current.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 3) ** 2;
    },
    [b, m, P, Tstart, Tb],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={15}
        onSample={(t) => {
          const { T, phase } = tempAt(t, b, m, P, Tstart, Tb);
          onLive({ t, T, phase });
        }}
      />

      {altitude !== undefined ? (
        <>
          <Ground kind="snow" from={-12} to={12} width={16} tile={4} tileZ={4} y={Y_LEVEL - 0.75} />
          <mesh position={[-1.5, Y_LEVEL + 1.4, -9]}>
            <coneGeometry args={[6, 5.5, 7]} />
            <meshStandardMaterial color="#64748b" roughness={0.95} flatShading />
          </mesh>
          <mesh position={[-1.5, Y_LEVEL + 3.35, -9]}>
            <coneGeometry args={[2.4, 1.6, 7]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.9} flatShading />
          </mesh>
          <Burner position={[0, Y_LEVEL - 0.75, 0]} power={1} />
          <SceneLabel position={[2.6, Y_LEVEL - 0.3, 1.2]}>туристическая горелка</SceneLabel>
        </>
      ) : (
        <>
          <LabBench position={[0, Y_LEVEL - 0.6 - 0.9, 0]} length={6.5} depth={L_FULL + 1.6} height={0.9} />
          {/* electric stove with a glowing hot plate */}
          <mesh position={[0, Y_LEVEL - 0.45, 0]} castShadow>
            <boxGeometry args={[L_FULL + 0.8, 0.3, L_FULL + 0.8]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.4} metalness={0.2} />
          </mesh>
          <mesh position={[0, Y_LEVEL - 0.29, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 1.9, 48]} />
            <meshStandardMaterial ref={plate} color="#7f1d1d" emissive="#ef4444" emissiveIntensity={0.8} side={THREE.DoubleSide} />
          </mesh>
          <SceneLabel position={[L_FULL / 2 + 0.6, Y_LEVEL - 0.4, L_FULL / 2 + 0.3]}>электроплита</SceneLabel>
        </>
      )}
      {/* glass pot: ice → water → steam */}
      <GlassVessel position={[0, Y_LEVEL + 0.05, 0]} size={[L_FULL, 0.6, L_FULL]} />
      <mesh ref={ice} position={[0, Y_LEVEL, 0]}>
        <boxGeometry args={[L_SOLID + 0.3, 0.45, L_SOLID + 0.3]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.55} roughness={0.08} depthWrite={false} />
      </mesh>
      <mesh ref={water} position={[0, Y_LEVEL - 0.1, 0]} visible={false}>
        <boxGeometry args={[L_FULL - 0.05, 0.42, L_FULL - 0.05]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.3} roughness={0.05} depthWrite={false} />
      </mesh>
      <group ref={steam} visible={false}>
        <Steam position={[0, Y_LEVEL + 0.2, 0]} spread={L_FULL * 0.3} height={2.4} count={10} />
      </group>
      <Thermometer position={[L_FULL / 2 - 0.35, Y_LEVEL - 0.25, -L_FULL / 2 + 0.35]} levelRef={thermo} height={1.7} />

      <ParticleInstances ref={instHandle} count={N_PARTICLES} color="#7ee8fa" radius={RADIUS} emissiveIntensity={0.4} />
      {altitude !== undefined && <SceneLabel position={[-1.5, Y_LEVEL + 4.5, -9]}>высота {altitude.toFixed(0)} м: вода кипит при {(Tb - 273.15).toFixed(0)}°C</SceneLabel>}
    </>
  );
}

export function PhaseTransitionsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, m, P, Tstart, altitude } = useControls("Фазовые переходы (вода)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Лёд в кастрюле на плите": "abstract", "Кипячение в горах": "mountain" },
    },
    m: { value: 0.5, min: 0.1, max: 2, step: 0.1, label: "m, кг" },
    P: { value: 800, min: 200, max: 2000, step: 50, label: "P нагревателя, Вт" },
    Tstart: { value: 250, min: 200, max: 273, step: 5, label: "T₀, К (начало)", render: (get) => get("Фазовые переходы (вода).scenario") === "abstract" },
    altitude: { value: 5642, min: 0, max: 8000, step: 100, label: "Высота, м (5642 = Эльбрус)", render: (get) => get("Фазовые переходы (вода).scenario") === "mountain" },
  });
  const mountain = scenario === "mountain";
  const effTstart = mountain ? 268 : Tstart;
  const Tb = mountain ? boilingPointAt(pressureAtAltitude(altitude)) : WATER.Tb0;

  const b = useMemo(() => computeBoundaries(m, P, effTstart, Tb), [m, P, effTstart, Tb]);

  const curve = useMemo(() => {
    const pts: { t: number; T: number }[] = [];
    const tMax = b.t4 * 1.15;
    for (let i = 0; i <= 80; i++) {
      const t = (tMax * i) / 80;
      pts.push({ t: Number(t.toFixed(1)), T: tempAt(t, b, m, P, effTstart, Tb).T });
    }
    return pts;
  }, [b, m, P, effTstart, Tb]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, T: effTstart, phase: 0 });

  const resetState = useCallback(() => {
    setLive({ t: 0, T: effTstart, phase: 0 });
  }, [effTstart]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const paramKey = `${scenario}|${m}|${P}|${Tstart}|${altitude}`;
  const firstParams = useRef(paramKey);
  useEffect(() => {
    if (firstParams.current === paramKey) return;
    firstParams.current = paramKey;
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const tC = (live.T - 273.15).toFixed(0);
  const CAPTIONS = [
    <>Плита греет лёд: его температура растёт ({tC} °C). Молекулы дрожат на своих местах в кристалле.</>,
    <><b>Лёд тает при 0 °C.</b> Плита продолжает греть, но температура стоит на месте: вся энергия уходит на разрушение кристалла (скрытая теплота плавления) — на графике «полка».</>,
    <>Льда нет, вода нагревается: {tC} °C. Молекулы свободно двигаются, но держатся вместе.</>,
    <><b>Вода кипит при {(Tb - 273.15).toFixed(0)} °C</b> — и снова «полка»: энергия идёт на отрыв молекул в пар, температура не растёт, пока не выкипит вся вода.</>,
    <>Вода выкипела, нагревается уже пар: {tC} °C.</>,
  ];
  const caption = CAPTIONS[Math.min(4, Math.max(0, live.phase))];
  const legend: LegendItem[] = [{ color: "#7ee8fa", label: "молекула воды", kind: "dot" }];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [2.4, 4.6, 7], fov: 50 }} orbitTarget={[0, Y_LEVEL, 0]} simplified={isMobile} maxDistance={24} minDistance={3} bloomThreshold={0.6} fogRange={[16, 45]}>
          <SceneContent
            key={clock.resetNonce}
            b={b}
            m={m}
            P={P}
            Tstart={effTstart}
            Tb={Tb}
            altitude={mountain ? altitude : undefined}
            running={clock.running}
            speed={clock.speed}
            onLive={setLive}
          />
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
            { label: "Время t", value: live.t.toFixed(1), unit: "с" },
            { label: "T(t)", value: (live.T - 273.15).toFixed(1), unit: "°C" },
            { label: "Стадия", value: PHASE_NAMES[live.phase] },
            { label: "t плавления", value: b.t1.toFixed(0), unit: "с" },
            { label: mountain ? "T кипения на высоте" : "t кипения (начало)", value: mountain ? (Tb - 273.15).toFixed(1) : b.t3.toFixed(0), unit: mountain ? "°C" : "с" },
          ]}
        />
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">Кривая нагрева T(t) — плато при фазовых переходах</p>
          <LiveChart data={curve} xKey="t" xType="number" xLabel="t, с" series={[{ key: "T", color: "#f87171", label: "T, К" }]} />
        </div>
      }
      note={
        mountain ? (
          <>
            Температура кипения зависит от атмосферного давления (уравнение Клаузиуса — Клапейрона): чем ниже
            давление, тем ниже T_кип. На вершине Эльбруса (5642 м) давление падает примерно вдвое, и вода
            закипает уже при {(Tb - 273.15).toFixed(0)}°C вместо привычных 100°C — поэтому в горах чай
            получается «недокипячённым», а для приготовления пищи нужен скороварка или больше времени.
          </>
        ) : (
          <>
            При постоянной мощности нагревателя температура растёт линейно, пока не начнётся фазовый переход:
            на плавлении (T=T_пл) и кипении (T=T_кип) вся подводимая энергия идёт на разрыв связей (скрытая
            теплота Q=mL), температура держится постоянной — плато на графике. Это ключевой признак фазового
            перехода первого рода.
          </>
        )
      }
    />
  );
}
