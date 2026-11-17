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
import { initParticles, stepParticles, rmsSpeed, type GasParticle, type Bounds } from "@/lib/particleGas";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { DialGauge, GlassVessel, Thermometer } from "@/components/sim/props/thermo";
import { BicycleWheel } from "@/components/sim/props/mechanics";
import { LabBench } from "@/components/sim/props/environment";

const RADIUS = 0.05;
const Y_LEVEL = 0.6;
const HOT = new THREE.Color("#f87171");
const COLD = new THREE.Color("#38bdf8");
/** pressure that puts the manometer needle at full scale */
const P_GAUGE_MAX = 80;

interface SamplePoint {
  t: number;
  Pmeasured: number;
  Ptheory: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  Pmeasured: number;
  Ptheory: number;
  vRms: number;
}

interface SceneContentProps {
  N: number;
  T: number;
  L: number;
  pump: boolean;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ N, T, L, pump, running, speed, onSample, onLive }: SceneContentProps) {
  const bounds: Bounds = useMemo(() => ({ xMin: -L / 2, xMax: L / 2, zMin: -L / 2, zMax: L / 2 }), [L]);
  const v0 = 0.15 * Math.sqrt(T);
  const [initialParticles] = useState(() => initParticles(N, bounds, v0, RADIUS));
  const particlesRef = useRef<GasParticle[]>(initialParticles);
  const impulseRef = useRef(0);
  const sampleDurationRef = useRef(0);
  const instHandle = useRef<ParticleInstancesHandle>(null);
  const maxSpeedRef = useRef(v0 * 1.6);
  const gauge = useRef(0);

  const handleFixedStep = useCallback(
    (dt: number) => {
      impulseRef.current += stepParticles(particlesRef.current, dt, bounds, { pairwise: false });
      sampleDurationRef.current += dt;
    },
    [bounds],
  );

  const handleFrame = useCallback(() => {
    instHandle.current?.sync(particlesRef.current, Y_LEVEL, (p) => {
      const sp = Math.hypot(p.vx, p.vz);
      const t = Math.min(sp / maxSpeedRef.current, 1);
      return COLD.clone().lerp(HOT, t);
    });
  }, []);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={8}
        onSample={(t) => {
          const Leff = Math.max(L - 2 * RADIUS, 0.1);
          const Aeff = Leff * Leff;
          const perimEff = 4 * Leff;
          const dtWindow = sampleDurationRef.current;
          const Pmeasured = dtWindow > 0 ? impulseRef.current / (perimEff * dtWindow) : 0;
          impulseRef.current = 0;
          sampleDurationRef.current = 0;
          const vRms = rmsSpeed(particlesRef.current);
          const Ptheory = (N * vRms * vRms) / (2 * Aeff);
          gauge.current = Pmeasured / P_GAUGE_MAX;
          onSample({ t, Pmeasured, Ptheory });
          onLive({ t, Pmeasured, Ptheory, vRms });
        }}
      />

      <LabBench position={[0, Y_LEVEL - 0.3 - 0.9, 0]} length={Math.max(L + 3.2, 6)} depth={L + 1.4} height={0.9} />
      {/* flat glass vessel holding the gas (the molecules move in one layer — we look at it from above) */}
      <GlassVessel position={[0, Y_LEVEL, 0]} size={[L, 0.5, L]} />
      <mesh position={[-L / 2 - 0.35, Y_LEVEL + 0.35, -L / 2 + 0.6]}>
        <cylinderGeometry args={[0.05, 0.05, 0.7, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.25} />
      </mesh>
      <DialGauge position={[-L / 2 - 0.35, Y_LEVEL + 0.95, -L / 2 + 0.6]} label="P" valueRef={gauge} radius={0.32} />
      <SceneLabel position={[-L / 2 - 0.35, Y_LEVEL + 1.45, -L / 2 + 0.6]}>манометр</SceneLabel>
      <Thermometer position={[L / 2 + 0.45, Y_LEVEL - 0.3, -L / 2 + 0.5]} level={T / 650} height={1.5} />
      <SceneLabel position={[L / 2 + 0.45, Y_LEVEL + 1.4, -L / 2 + 0.5]}>{`термометр, T = ${T.toFixed(0)}`}</SceneLabel>

      <ParticleInstances ref={instHandle} count={N} color="#ffffff" radius={RADIUS} emissiveIntensity={0.3} />

      {pump && (
        <>
          {/* piston, rod and T-handle of the bicycle pump */}
          <mesh position={[L / 2 + 0.06, Y_LEVEL, 0]}>
            <boxGeometry args={[0.1, 0.48, L - 0.02]} />
            <meshStandardMaterial color="#71717a" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[L / 2 + 0.95, Y_LEVEL, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 1.7, 12]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh position={[L / 2 + 1.8, Y_LEVEL, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 1.3, 14]} />
            <meshStandardMaterial color="#111827" roughness={0.7} />
          </mesh>
          <SceneLabel position={[L / 2 + 1.0, Y_LEVEL + 0.55, 0]}>поршень и ручка насоса</SceneLabel>
          {/* hose to the bicycle tyre */}
          <mesh position={[-L / 2 - 0.9, Y_LEVEL, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 1.6, 10]} />
            <meshStandardMaterial color="#1f2937" roughness={0.8} />
          </mesh>
          <BicycleWheel position={[-L / 2 - 2.6, Y_LEVEL + 0.2, 0]} radius={0.9} rotation={[0, Math.PI / 2, 0]} />
          <SceneLabel position={[-L / 2 - 2.6, Y_LEVEL + 1.35, 0]}>шина велосипеда</SceneLabel>
        </>
      )}
    </>
  );
}

export function IdealGasMktSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, N, T, L, compression } = useControls("МКТ идеального газа", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Газ в сосуде с манометром": "abstract", "Насос велосипедной шины": "pump" },
    },
    N: { value: 90, min: 30, max: 150, step: 5, label: "N, число частиц" },
    T: { value: 300, min: 50, max: 500, step: 10, label: "T₀, усл.ед.", render: (get) => get("МКТ идеального газа.scenario") === "abstract" },
    L: { value: 4, min: 2.5, max: 5, step: 0.25, label: "L, усл.ед. (размер сосуда)", render: (get) => get("МКТ идеального газа.scenario") === "abstract" },
    compression: { value: 0, min: 0, max: 0.6, step: 0.02, label: "сжатие поршня", render: (get) => get("МКТ идеального газа.scenario") === "pump" },
  });

  const pump = scenario === "pump";
  const L0Pump = 4;
  const T0Pump = 250;
  const Lpump = L0Pump * (1 - compression);
  const Tpump = T0Pump * (1 / (1 - compression)) ** 1.2; // adiabatic heating, γ_air≈1.4

  const effN = N;
  const effT = pump ? Tpump : T;
  const effL = pump ? Lpump : L;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, Pmeasured: 0, Ptheory: 0, vRms: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, Pmeasured: 0, Ptheory: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => ((prev[prev.length - 1]?.t ?? -1) >= p.t ? [p] : prev.length > 300 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, Pmeasured: 0, Ptheory: 0, vRms: 0 });
    setSeries([{ t: 0, Pmeasured: 0, Ptheory: 0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const play = clock.play;
  useEffect(() => {
    play();
  }, [effN, effT, effL, play]);

  const caption = pump ? (
    <>
      <b>Насос сжимает воздух:</b> поршень (справа) движется навстречу молекулам, и они отскакивают от него быстрее — газ нагревается до T = {effT.toFixed(0)}. Работа, которую вы совершаете,
      переходит во внутреннюю энергию. Поэтому корпус насоса при накачке шины становится тёплым.
    </>
  ) : (
    <>
      Молекулы летают и бьются о стенки сосуда. Каждый удар чуть-чуть толкает стенку — <b>из миллиардов таких толчков и складывается давление</b>, которое показывает манометр. Нагрейте газ —
      молекулы станут быстрее (больше красных), удары сильнее и чаще, давление вырастет.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#38bdf8", label: "медленная молекула", kind: "dot" },
    { color: "#f87171", label: "быстрая молекула", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={pump ? { position: [0.5, 5.5, 7.5], fov: 50 } : { position: [2.5, 5, 6.5], fov: 50 }} orbitTarget={[pump ? -0.5 : 0, Y_LEVEL, 0]} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={`${clock.resetNonce}:${effN}:${effT}:${effL}`} N={effN} T={effT} L={effL} pump={pump} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
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
            { label: "Время t", value: live.t.toFixed(2), unit: "с" },
            { label: "v_rms частиц", value: live.vRms.toFixed(2), unit: "усл.ед/с" },
            { label: "P измеренное (удары о стенки)", value: live.Pmeasured.toFixed(2), unit: "усл.ед." },
            { label: "P теория = N·v²/(2A)", value: live.Ptheory.toFixed(2), unit: "усл.ед." },
            pump
              ? { label: "T (адиабатический нагрев)", value: effT.toFixed(0), unit: "усл.ед.", color: "#f87171" }
              : { label: "Отношение P_изм/P_теор", value: live.Ptheory > 0 ? (live.Pmeasured / live.Ptheory).toFixed(3) : "—" },
          ]}
        />
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">Давление: измеренное vs теория МКТ</p>
          <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "Pmeasured", color: "#4ade80", label: "P измерено" }, { key: "Ptheory", color: "#fbbf24", label: "P теория" }]} />
        </div>
      }
      note={
        pump ? (
          <>
            При сжатии насосом воздух не успевает отдать тепло наружу (быстрый процесс ≈ адиабата):
            T·V^(γ−1)=const. Уменьшая объём поршнем, вы совершаете над газом работу — она переходит в
            кинетическую энергию молекул, и температура растёт: именно поэтому корпус велосипедного насоса
            заметно нагревается при накачке шины.
          </>
        ) : (
          <>
            Давление газа рождается из ударов молекул о стенки сосуда. Измеренное давление (сумма импульсов
            ударов за время / периметр) совпадает с формулой МКТ P=N⟨v²⟩/(2A) — основным уравнением
            молекулярно-кинетической теории (2D-аналог P=⅓nm⟨v²⟩). Цвет частиц кодирует скорость (синий —
            медленная, красная — быстрая).
          </>
        )
      }
    />
  );
}
