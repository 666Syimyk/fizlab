import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { ParticleInstances, type ParticleInstancesHandle } from "@/components/sim/ParticleInstances";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { Histogram } from "@/components/sim/Histogram";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { initParticles, stepParticles, meanSpeed, type GasParticle, type Bounds } from "@/lib/particleGas";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { GlassVessel, Steam, Thermometer } from "@/components/sim/props/thermo";
import { LabBench } from "@/components/sim/props/environment";

const RADIUS = 0.06;
const Y_LEVEL = 0.6;
const BINS = 16;
const HOT = new THREE.Color("#f87171");
const COLD = new THREE.Color("#38bdf8");

interface BinPoint {
  v: number;
  count: number;
  theory: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  meanV: number;
  meanVTheory: number;
}
interface SamplePoint {
  t: number;
  meanV: number;
  meanVTheory: number;
  [key: string]: number;
}

interface SceneContentProps {
  N: number;
  v0: number;
  L: number;
  evaporate: boolean;
  running: boolean;
  speed: number;
  onHist: (bins: BinPoint[]) => void;
  onLive: (n: LiveNumbers) => void;
  onSample: (p: SamplePoint) => void;
}

function SceneContent({ N, v0, L, evaporate, running, speed, onHist, onLive, onSample }: SceneContentProps) {
  const bounds: Bounds = useMemo(() => ({ xMin: -L / 2, xMax: L / 2, zMin: -L / 2, zMax: L / 2 }), [L]);
  const [initialParticles] = useState(() => initParticles(N, bounds, v0, RADIUS));
  const particlesRef = useRef<GasParticle[]>(initialParticles);
  const instHandle = useRef<ParticleInstancesHandle>(null);
  const sigma = v0 / Math.SQRT2;
  const maxV = v0 * 2.4;
  const vEscape = v0 * 1.7;

  const handleFixedStep = useCallback(
    (dt: number) => {
      stepParticles(particlesRef.current, dt, bounds, { pairwise: true });
      if (evaporate) {
        const arr = particlesRef.current;
        for (let i = arr.length - 1; i >= 0; i--) {
          const sp = Math.hypot(arr[i].vx, arr[i].vz);
          if (sp > vEscape && arr.length > 25 && Math.random() < dt * 3) {
            arr.splice(i, 1);
          }
        }
      }
    },
    [bounds, evaporate, vEscape],
  );

  const handleFrame = useCallback(() => {
    instHandle.current?.sync(particlesRef.current, Y_LEVEL, (p) => {
      const sp = Math.hypot(p.vx, p.vz);
      const t = Math.min(sp / (v0 * 1.8), 1);
      return COLD.clone().lerp(HOT, t);
    });
  }, [v0]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={6}
        onSample={(t) => {
          const bins: BinPoint[] = [];
          const counts = new Array(BINS).fill(0);
          for (const p of particlesRef.current) {
            const sp = Math.hypot(p.vx, p.vz);
            const bi = Math.min(BINS - 1, Math.floor((sp / maxV) * BINS));
            if (bi >= 0) counts[bi]++;
          }
          const binW = maxV / BINS;
          for (let i = 0; i < BINS; i++) {
            const vMid = (i + 0.5) * binW;
            const theory = (vMid / (sigma * sigma)) * Math.exp((-vMid * vMid) / (2 * sigma * sigma)) * N * binW;
            bins.push({ v: Number(vMid.toFixed(2)), count: counts[i], theory: Number(theory.toFixed(2)) });
          }
          onHist(bins);
          const meanV = meanSpeed(particlesRef.current);
          const meanVTheory = sigma * Math.sqrt(Math.PI / 2);
          onLive({ t, meanV, meanVTheory });
          onSample({ t, meanV, meanVTheory });
        }}
      />

      <LabBench position={[0, Y_LEVEL - 0.3 - 0.9, 0]} length={Math.max(L + 2.4, 6)} depth={L + 1.4} height={0.9} />
      {evaporate ? (
        <>
          {/* square glass mug of hot tea seen from above: the molecules move in the surface layer */}
          <GlassVessel position={[0, Y_LEVEL - 0.15, 0]} size={[L, 0.8, L]} frameColor="#78350f" />
          <mesh position={[0, Y_LEVEL - 0.33, 0]}>
            <boxGeometry args={[L - 0.04, 0.42, L - 0.04]} />
            <meshStandardMaterial color="#92400e" transparent opacity={0.55} roughness={0.1} depthWrite={false} />
          </mesh>
          <mesh position={[L / 2 + 0.25, Y_LEVEL - 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
            <torusGeometry args={[0.3, 0.06, 10, 24, Math.PI]} />
            <meshStandardMaterial color="#78350f" metalness={0.3} roughness={0.4} />
          </mesh>
          <Steam position={[0, Y_LEVEL + 0.1, 0]} spread={L * 0.35} height={2} count={9} />
          <Thermometer position={[-L / 2 + 0.4, Y_LEVEL - 0.55, -L / 2 + 0.4]} level={0.75} height={1.6} />
        </>
      ) : (
        <GlassVessel position={[0, Y_LEVEL, 0]} size={[L, 0.5, L]} />
      )}

      <ParticleInstances ref={instHandle} count={N} color="#ffffff" radius={RADIUS} emissiveIntensity={0.3} />
      {evaporate && <SceneLabel position={[0, Y_LEVEL + 2.2, 0]}>пар — улетают самые быстрые молекулы</SceneLabel>}
      {evaporate && <SceneLabel position={[L / 2, Y_LEVEL - 0.7, L / 2 + 0.3]}>кружка горячего чая</SceneLabel>}
    </>
  );
}

export function MaxwellBoltzmannSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, N, T, L } = useControls("Распределение Максвелла", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Газ в сосуде: скорости перемешиваются": "abstract", "Испарительное охлаждение (чай)": "evaporation" },
    },
    N: { value: 220, min: 100, max: 400, step: 10, label: "N, число частиц" },
    T: { value: 300, min: 100, max: 600, step: 20, label: "T, усл.ед." },
    L: { value: 4.5, min: 3, max: 6, step: 0.25, label: "L, усл.ед. (размер сосуда)" },
  });
  const evaporate = scenario === "evaporation";
  const v0 = 0.15 * Math.sqrt(T);

  const [hist, setHist] = useState<BinPoint[]>([]);
  const [live, setLive] = useState<LiveNumbers>({ t: 0, meanV: v0, meanVTheory: (v0 / Math.SQRT2) * Math.sqrt(Math.PI / 2) });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, meanV: v0, meanVTheory: v0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => ((prev[prev.length - 1]?.t ?? -1) >= p.t ? [p] : prev.length > 300 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setHist([]);
    setLive({ t: 0, meanV: v0, meanVTheory: (v0 / Math.SQRT2) * Math.sqrt(Math.PI / 2) });
    setSeries([{ t: 0, meanV: v0, meanVTheory: v0 }]);
  }, [v0]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const f2 = (x: number) => x.toFixed(2).replace(".", ",");
  const caption = evaporate ? (
    <>
      <b>Чай остывает:</b> из кружки улетают только самые быстрые (красные) молекулы — это пар. Оставшиеся в среднем медленнее: средняя скорость упала с {f2(v0)} до {f2(live.meanV)}, а средняя
      скорость молекул и есть температура.
    </>
  ) : (
    <>
      В начале все молекулы летели с одинаковой скоростью. После множества столкновений скорости «перемешались»: большинство молекул средние, немного медленных (синие) и немного очень быстрых
      (красные). Гистограмма справа принимает форму кривой Максвелла.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#38bdf8", label: "медленная", kind: "dot" },
    { color: "#f87171", label: "быстрая", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [2.5, 5, 6.5], fov: 50 }} orbitTarget={[0, Y_LEVEL, 0]} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={`${clock.resetNonce}:${N}:${v0}:${L}`} N={N} v0={v0} L={L} evaporate={evaporate} running={clock.running} speed={clock.speed} onHist={setHist} onLive={setLive} onSample={handleSample} />
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
            { label: "⟨v⟩ измеренная", value: live.meanV.toFixed(2), unit: "усл.ед/с", color: evaporate ? (live.meanV < v0 ? "#4ade80" : "#f87171") : "#4ade80" },
            { label: "⟨v⟩ теория =σ√(π/2)", value: live.meanVTheory.toFixed(2), unit: "усл.ед/с" },
            { label: evaporate ? "⟨v⟩ в начале (горячий чай)" : "Все частицы стартуют с v₀", value: v0.toFixed(2), unit: "усл.ед/с" },
          ]}
        />
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Гистограмма скоростей vs распределение Максвелла (2D)</p>
            <Histogram data={hist} xKey="v" barKey="count" barColor="#7c6cf5" xLabel="v, усл.ед/с" yLabel="число частиц" overlay={{ key: "theory", color: "#fbbf24", label: "теория" }} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Средняя скорость: измеренная vs теория</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "meanV", color: "#4ade80", label: "⟨v⟩ изм." }, { key: "meanVTheory", color: "#fbbf24", label: "⟨v⟩ теория" }]} />
          </div>
        </div>
      }
      note={
        evaporate ? (
          <>
            Испаряются («улетают из чашки») только самые быстрые молекулы — с v выше порога. Убирая именно
            хвост быстрых частиц из распределения, мы снижаем СРЕДНЮЮ энергию оставшихся — то есть температуру:
            ⟨v⟩ измеренная падает со временем ниже начального v₀. Это и есть испарительное охлаждение — тот же
            эффект остужает чашку чая и используется физиками для охлаждения атомов до долей микрокельвина.
          </>
        ) : (
          <>
            Все частицы стартуют с одинаковой по модулю скоростью v₀ — распределение вырождено. Столкновения
            друг с другом случайно перераспределяют скорости, и уже через несколько секунд гистограмма
            принимает форму распределения Максвелла (в 2D — распределение Рэлея) f(v)=(v/σ²)e^(−v²/2σ²), σ=v₀/√2 —
            жёлтая кривая. Полная энергия (Σv²) сохраняется точно, форма распределения устанавливается сама.
          </>
        )
      }
    />
  );
}
