import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { ParticleInstances, type ParticleInstancesHandle } from "@/components/sim/ParticleInstances";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { DialGauge, GlassVessel } from "@/components/sim/props/thermo";
import { LabBench } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { initParticles, stepParticles, rmsSpeed, type GasParticle, type Bounds } from "@/lib/particleGas";

const RADIUS = 0.11;
const Y_LEVEL = 0.6;
const R_GAS = 8.314;

const SUBSTANCES: Record<string, { a: number; b: number }> = {
  "Гелий He": { a: 0.00346, b: 2.38e-5 },
  "Азот N₂": { a: 0.1408, b: 3.91e-5 },
  "Углекислый газ CO₂": { a: 0.3640, b: 4.27e-5 },
  "Водяной пар H₂O": { a: 0.5536, b: 3.05e-5 },
};

interface CurvePoint {
  V: number;
  Pideal: number;
  Pvdw: number;
  [key: string]: number;
}
interface SamplePoint {
  t: number;
  Pmeasured: number;
  Pideal: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  Pmeasured: number;
  Pideal: number;
}

interface SceneContentProps {
  N: number;
  T: number;
  L: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ N, T, L, running, speed, onSample, onLive }: SceneContentProps) {
  const bounds: Bounds = useMemo(() => ({ xMin: -L / 2, xMax: L / 2, zMin: -L / 2, zMax: L / 2 }), [L]);
  const v0 = 0.15 * Math.sqrt(T);
  const [initialParticles] = useState(() => initParticles(N, bounds, v0, RADIUS));
  const particlesRef = useRef<GasParticle[]>(initialParticles);
  const impulseRef = useRef(0);
  const sampleDurationRef = useRef(0);
  const instHandle = useRef<ParticleInstancesHandle>(null);

  const handleFixedStep = useCallback(
    (dt: number) => {
      impulseRef.current += stepParticles(particlesRef.current, dt, bounds, { pairwise: true });
      sampleDurationRef.current += dt;
    },
    [bounds],
  );

  const handleFrame = useCallback(() => {
    instHandle.current?.sync(particlesRef.current, Y_LEVEL, () => "#fbbf24");
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
          const Pideal = (N * vRms * vRms) / (2 * Aeff);
          onSample({ t, Pmeasured, Pideal });
          onLive({ t, Pmeasured, Pideal });
        }}
      />

      <LabBench position={[0, Y_LEVEL - 0.3 - 0.9, 0]} length={Math.max(L + 2.4, 6)} depth={L + 1.4} height={0.9} />
      {/* thick-walled steel cylinder with an observation window: real gases are studied at high pressure */}
      <GlassVessel position={[0, Y_LEVEL, 0]} size={[L, 0.5, L]} frameColor="#64748b" />
      <mesh position={[0, Y_LEVEL - 0.24, 0]}>
        <boxGeometry args={[L + 0.5, 0.06, L + 0.5]} />
        <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[-L / 2 - 0.3, Y_LEVEL + 0.25, -L / 2 + 0.5]}>
        <cylinderGeometry args={[0.05, 0.05, 0.6, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.25} />
      </mesh>
      <DialGauge position={[-L / 2 - 0.3, Y_LEVEL + 0.85, -L / 2 + 0.5]} label="P" value={0.62} radius={0.32} />

      <ParticleInstances ref={instHandle} count={N} color="#ffffff" radius={RADIUS} emissiveIntensity={0.3} />
      <SceneLabel position={[0, Y_LEVEL + 0.75, L / 2]}>молекулы занимают место и притягиваются</SceneLabel>
    </>
  );
}

export function RealGasesVdwSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, substance, n, T, Vshow, TrelTc } = useControls("Реальные газы (Ван-дер-Ваальс)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Свободный выбор вещества": "abstract", "Сжижение CO₂": "co2" },
    },
    substance: {
      value: "Углекислый газ CO₂",
      options: Object.keys(SUBSTANCES),
      label: "Вещество",
      render: (get) => get("Реальные газы (Ван-дер-Ваальс).scenario") === "abstract",
    },
    n: { value: 1, min: 0.5, max: 2, step: 0.1, label: "n, моль" },
    T: { value: 320, min: 250, max: 500, step: 10, label: "T, К", render: (get) => get("Реальные газы (Ван-дер-Ваальс).scenario") === "abstract" },
    TrelTc: { value: 0.95, min: 0.85, max: 1.25, step: 0.01, label: "T / T_крит", render: (get) => get("Реальные газы (Ван-дер-Ваальс).scenario") === "co2" },
    Vshow: { value: 0.6, min: 0.1, max: 2, step: 0.05, label: "V, л (точка сравнения)" },
  });
  const co2 = scenario === "co2";

  const { N, Tsim, L } = useControls("Частицы (наглядность искл. объёма)", {
    N: { value: 70, min: 30, max: 100, step: 5, label: "N, частиц" },
    Tsim: { value: 320, min: 100, max: 600, step: 20, label: "T, усл.ед." },
    L: { value: 3.6, min: 2.5, max: 5, step: 0.25, label: "L, усл.ед." },
  });

  const effSubstance = co2 ? "Углекислый газ CO₂" : substance;
  const { a, b } = SUBSTANCES[effSubstance];
  const Tc = (8 * a) / (27 * R_GAS * b);
  const effT = co2 ? TrelTc * Tc : T;
  const Vmin = n * b * 1.15;
  const curve = useMemo(() => {
    const pts: CurvePoint[] = [];
    const Vmax = Math.max(n * 3e-3, Vmin * 6);
    for (let i = 0; i <= 60; i++) {
      const V = Vmin + ((Vmax - Vmin) * i) / 60;
      const Pideal = (n * R_GAS * effT) / V;
      const Pvdw = (n * R_GAS * effT) / (V - n * b) - (a * n * n) / (V * V);
      pts.push({ V: Number((V * 1000).toFixed(4)), Pideal: Number((Pideal / 1000).toFixed(2)), Pvdw: Number((Pvdw / 1000).toFixed(2)) });
    }
    return pts;
  }, [a, b, n, effT, Vmin]);

  const Vpoint = Math.max(Vshow / 1000, Vmin * 1.01);
  const PidealPoint = (n * R_GAS * effT) / Vpoint;
  const PvdwPoint = (n * R_GAS * effT) / (Vpoint - n * b) - (a * n * n) / (Vpoint * Vpoint);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, Pmeasured: 0, Pideal: 0 });
  const below = effT < Tc;
  const realCaption = co2 ? (
    below ? (
      <>
        <b>CO₂ ниже критической температуры</b> (T = {(effT - 273).toFixed(0)} °C &lt; {(Tc - 273).toFixed(0)} °C): если сжимать такой газ, он перестаёт вести себя как идеальный и <b>превращается в жидкость</b> —
        на изотерме Ван-дер-Ваальса появляется «петля». Так заправляют огнетушители и сифоны.
      </>
    ) : (
      <>
        <b>CO₂ выше критической температуры:</b> сколько ни сжимай, жидкость не появится — изотерма плавная. Ниже {(Tc - 273).toFixed(0)} °C углекислый газ можно сжижить давлением.
      </>
    )
  ) : (
    <>
      В реальном газе молекулы не точки: они <b>занимают место</b> (поправка b) и <b>притягиваются</b> друг к другу (поправка a). При сильном сжатии давление поэтому отличается от идеального: P = nRT/(V −
      nb) − an²/V². Модель с шариками показывает первый эффект: давление выше идеального.
    </>
  );
  const realLegend: LegendItem[] = [{ color: "#fbbf24", label: "молекула газа", kind: "dot" }];
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, Pmeasured: 0, Pideal: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => ((prev[prev.length - 1]?.t ?? -1) >= p.t ? [p] : prev.length > 300 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, Pmeasured: 0, Pideal: 0 });
    setSeries([{ t: 0, Pmeasured: 0, Pideal: 0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  return (
    <SimShell
      scene={
        <SceneCanvas camera={{ position: [2.5, 5, 6.5], fov: 50 }} orbitTarget={[0, Y_LEVEL, 0]} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={`${clock.resetNonce}:${N}:${Tsim}:${L}`} N={N} T={Tsim} L={L} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
        </SceneCanvas>
      }
      legend={realLegend}
      caption={realCaption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: "P идеальный газ (V,T)", value: (PidealPoint / 1000).toFixed(1), unit: "кПа" },
            { label: "P Ван-дер-Ваальс (V,T)", value: (PvdwPoint / 1000).toFixed(1), unit: "кПа" },
            ...(co2 ? [{ label: "T", value: effT.toFixed(1), unit: "К" }, { label: "T_крит(CO₂)", value: Tc.toFixed(1), unit: "К" }] : [{ label: "Отличие", value: (((PvdwPoint - PidealPoint) / PidealPoint) * 100).toFixed(1), unit: "%" }]),
            { label: "P измеренное (частицы)", value: live.Pmeasured.toFixed(2), unit: "усл.ед." },
            { label: "P идеальное (частицы)", value: live.Pideal.toFixed(2), unit: "усл.ед." },
          ]}
        />
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">{co2 ? "Изотерма CO₂ на диаграмме P–V" : "Изотерма: идеальный газ vs Ван-дер-Ваальс"}</p>
            <LiveChart data={curve} xKey="V" xType="number" xLabel="V, л" series={[{ key: "Pideal", color: "#38bdf8", label: "P идеал." }, { key: "Pvdw", color: "#f87171", label: "P Ван-дер-Ваальса" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Модель частиц конечного размера: измеренное давление выше идеального</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "Pmeasured", color: "#f87171", label: "P измерено" }, { key: "Pideal", color: "#38bdf8", label: "P идеал." }]} />
          </div>
        </div>
      }
      note={
        co2 ? (
          <>
            При T ниже критической ({Tc.toFixed(0)} К для CO₂) уравнение Ван-дер-Ваальса на кривой P(V) даёт
            немонотонный участок (dP/dV&gt;0) — это математический сигнал того, что однородный газ в этой
            области нестабилен и реально распадается на жидкость и пар одновременно (изотерма Максвелла
            заменяет этот участок горизонтальным отрезком постоянного давления). Именно так CO₂ сжижают:
            охлаждают ниже 304 К и сжимают — газ превращается в жидкость. При T выше критической (ползунок
            &gt;1) сжижение невозможно ни при каком давлении — вещество остаётся сверхкритическим флюидом.
          </>
        ) : (
          <>
            Уравнение Ван-дер-Ваальса (P+an²/V²)(V−nb)=nRT учитывает собственный объём молекул (b) и силы
            притяжения (a). При малых V давление реального газа резко растёт (столкновения чаще из-за
            недоступного объёма nb) — это видно и в модели частиц конечного радиуса справа: из-за исключённого
            объёма измеренное давление стабильно выше формулы идеального газа P=N⟨v²⟩/(2A), не учитывающей
            размер частиц.
          </>
        )
      }
    />
  );
}
