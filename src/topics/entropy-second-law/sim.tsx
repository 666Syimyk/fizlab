import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
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
import { GlassVessel } from "@/components/sim/props/thermo";
import { LabBench } from "@/components/sim/props/environment";

const RADIUS = 0.055;
const Y_LEVEL = 0.6;

function lnFactTable(N: number): Float64Array {
  const t = new Float64Array(N + 1);
  let s = 0;
  for (let i = 2; i <= N; i++) {
    s += Math.log(i);
    t[i] = s;
  }
  return t;
}

interface SamplePoint {
  t: number;
  S: number;
  nLeft: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  S: number;
  Smax: number;
  nLeft: number;
  nRight: number;
  aInRight: number;
}

interface SceneContentProps {
  N: number;
  v0: number;
  L: number;
  gap: number;
  gases: boolean;
  running: boolean;
  speed: number;
  lnFact: Float64Array;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ N, v0, L, gap, gases, running, speed, lnFact, onSample, onLive }: SceneContentProps) {
  const bounds: Bounds = useMemo(() => ({ xMin: -L / 2, xMax: L / 2, zMin: -L / 2, zMax: L / 2 }), [L]);
  const [initialParticles] = useState(() => gases
      ? [
          ...initParticles(Math.floor(N / 2), { xMin: -L / 2, xMax: -0.05, zMin: -L / 2, zMax: L / 2 }, v0, RADIUS),
          ...initParticles(N - Math.floor(N / 2), { xMin: 0.05, xMax: L / 2, zMin: -L / 2, zMax: L / 2 }, v0, RADIUS),
        ]
      : initParticles(N, { xMin: -L / 2, xMax: -0.05, zMin: -L / 2, zMax: L / 2 }, v0, RADIUS),
  );
  const particlesRef = useRef<GasParticle[]>(initialParticles);
  const nA = Math.floor(N / 2);
  const instHandle = useRef<ParticleInstancesHandle>(null);
  const lnW = useCallback(
    (nLeft: number) => lnFact[N] - lnFact[nLeft] - lnFact[N - nLeft],
    [lnFact, N],
  );
  const Smax = useMemo(() => lnW(Math.floor(N / 2)), [lnW, N]);

  const handleFixedStep = useCallback(
    (dt: number) => {
      stepParticles(particlesRef.current, dt, bounds, {
        pairwise: true,
        divider: { x: 0, gapMin: -gap / 2, gapMax: gap / 2 },
      });
    },
    [bounds, gap],
  );

  const handleFrame = useCallback(() => {
    if (gases) {
      instHandle.current?.sync(particlesRef.current, Y_LEVEL, (_p, i) => (i < nA ? "#7c6cf5" : "#fbbf24"));
    } else {
      instHandle.current?.sync(particlesRef.current, Y_LEVEL, (p) => (p.x < 0 ? "#7c6cf5" : "#fbbf24"));
    }
  }, [gases, nA]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={10}
        onSample={(t) => {
          let nLeft = 0;
          for (const p of particlesRef.current) if (p.x < 0) nLeft++;
          const S = lnW(nLeft);
          let aInRight = 0;
          if (gases) {
            const arr = particlesRef.current;
            for (let i = 0; i < nA; i++) if (arr[i].x >= 0) aInRight++;
          }
          onSample({ t, S, nLeft });
          onLive({ t, S, Smax, nLeft, nRight: N - nLeft, aInRight: nA > 0 ? aInRight / nA : 0 });
        }}
      />

      <LabBench position={[0, Y_LEVEL - 0.3 - 0.9, 0]} length={Math.max(L + 2.4, 6)} depth={L + 1.4} height={0.9} />
      <GlassVessel position={[0, Y_LEVEL, 0]} size={[L, 0.5, L]} />

      {/* divider wall at x=0 with a gap along z */}
      <mesh position={[0, Y_LEVEL, (gap / 2 + L / 2) / 2]}>
        <boxGeometry args={[0.05, 0.5, L / 2 - gap / 2]} />
        <meshStandardMaterial color="#52525b" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, Y_LEVEL, -(gap / 2 + L / 2) / 2]}>
        <boxGeometry args={[0.05, 0.5, L / 2 - gap / 2]} />
        <meshStandardMaterial color="#52525b" metalness={0.4} roughness={0.5} />
      </mesh>

      <ParticleInstances ref={instHandle} count={N} color="#ffffff" radius={RADIUS} emissiveIntensity={0.3} />
      {gases ? (
        <>
          <SceneLabel position={[-L / 4, Y_LEVEL + 0.7, L / 2]} tone="#7c6cf5">газ A</SceneLabel>
          <SceneLabel position={[L / 4, Y_LEVEL + 0.7, L / 2]} tone="#fbbf24">газ B</SceneLabel>
          <SceneLabel position={[0, Y_LEVEL + 0.7, 0]}>перегородка с отверстием</SceneLabel>
        </>
      ) : (
        <>
          <SceneLabel position={[0, Y_LEVEL + 0.7, 0]}>перегородка с отверстием</SceneLabel>
          <SceneLabel position={[L / 4, Y_LEVEL + 0.7, L / 2]}>сначала здесь пусто (вакуум)</SceneLabel>
        </>
      )}
    </>
  );
}

export function EntropySecondLawSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, N, T, L, gap } = useControls("Энтропия и II начало", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Расширение в вакуум": "abstract", "Смешение двух цветных газов": "gases" },
    },
    N: { value: 100, min: 40, max: 150, step: 5, label: "N, число частиц" },
    T: { value: 300, min: 100, max: 600, step: 20, label: "T, усл.ед." },
    L: { value: 4.5, min: 3, max: 6, step: 0.25, label: "L, усл.ед. (размер сосуда)" },
    gap: { value: 1, min: 0.2, max: 3, step: 0.1, label: "зазор в перегородке, усл.ед." },
  });
  const gases = scenario === "gases";
  const v0 = 0.15 * Math.sqrt(T);

  const lnFact = useMemo(() => lnFactTable(N), [N]);
  const Smax = useMemo(() => lnFact[N] - lnFact[Math.floor(N / 2)] - lnFact[N - Math.floor(N / 2)], [lnFact, N]);
  const S0 = lnFact[N] - lnFact[N] - lnFact[0];

  const [live, setLive] = useState<LiveNumbers>({ t: 0, S: S0, Smax, nLeft: N, nRight: 0, aInRight: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, S: S0, nLeft: N }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => ((prev[prev.length - 1]?.t ?? -1) >= p.t ? [p] : prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, S: S0, Smax, nLeft: N, nRight: 0, aInRight: 0 });
    setSeries([{ t: 0, S: S0, nLeft: N }]);
  }, [S0, Smax, N]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const caption = gases ? (
    <>
      Два газа разделены перегородкой с отверстием. Молекулы сами пролетают в чужую половину, и цвета перемешиваются — <b>обратно сами они не разделятся никогда</b>: смешанных расположений
      несравнимо больше, чем разделённых. Это и есть рост энтропии — «стрела времени», как у разбитой чашки.
    </>
  ) : (
    <>
      Все молекулы начали слева, справа вакуум. Через отверстие они расползаются по всему сосуду: слева осталось {live.nLeft} из {N}. Энтропия S = k·ln W растёт к максимуму — газ никогда сам не
      соберётся обратно в одну половину.
    </>
  );
  const legend: LegendItem[] = gases
    ? [
        { color: "#7c6cf5", label: "газ A", kind: "dot" },
        { color: "#fbbf24", label: "газ B", kind: "dot" },
      ]
    : [
        { color: "#7c6cf5", label: "молекула в левой половине", kind: "dot" },
        { color: "#fbbf24", label: "перелетела вправо", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [2.5, 5, 6.5], fov: 50 }} orbitTarget={[0, Y_LEVEL, 0]} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={`${clock.resetNonce}:${N}:${v0}:${L}`} N={N} v0={v0} L={L} gap={gap} gases={gases} running={clock.running} speed={clock.speed} lnFact={lnFact} onSample={handleSample} onLive={setLive} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        gases ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Доля A, оказавшихся справа", value: (live.aInRight * 100).toFixed(1), unit: "%", color: "#7c6cf5" },
              { label: "Степень перемешивания", value: (live.aInRight * 200).toFixed(0), unit: "%", color: "#4ade80" },
              { label: "Полное смешение при", value: "50", unit: "% справа" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Частиц слева / справа", value: `${live.nLeft} / ${live.nRight}` },
              { label: "S/k = ln W", value: live.S.toFixed(2) },
              { label: "S_max/k = ln W_max", value: live.Smax.toFixed(2) },
              { label: "Доля от максимума", value: ((live.S / live.Smax) * 100).toFixed(1), unit: "%" },
            ]}
          />
        )
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">{gases ? "Доля A справа со временем (перемешивание)" : "Энтропия S/k = ln W со временем"}</p>
          <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "S", color: "#4ade80", label: "S/k" }]} yDomain={[0, "auto"]} />
        </div>
      }
      note={
        gases ? (
          <>
            Газы A и B стартуют разделёнными, но неразличимы по энергии — тепловое движение перемешивает их
            без всякой внешней причины, пока состав не станет однородным (50/50) по всему объёму. Обратный
            процесс — самопроизвольное разделение уже перемешанных газов обратно по сторонам — не запрещён
            механикой отдельных частиц, но статистически невероятен: подобно тому, как осколки разбитой чашки
            практически никогда не собираются обратно сами — не потому что это невозможно, а потому что
            упорядоченных микросостояний ничтожно мало по сравнению с неупорядоченными. Это и есть стрела
            времени в термодинамике.
          </>
        ) : (
          <>
            Все частицы стартуют в левой половине (W=1, S=0). Через зазор в перегородке газ необратимо
            занимает весь объём: число микросостояний W=N!/(n!(N−n)!) растёт, энтропия S=k·ln W увеличивается
            и стремится к максимуму при n_лево≈N/2 — второе начало термодинамики: изолированная система
            эволюционирует к состоянию с наибольшим числом микросостояний. Обратный процесс (самопроизвольный
            возврат всех частиц влево) статистически исчезающе маловероятен.
          </>
        )
      }
    />
  );
}
