import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Burner, DialGauge, Thermometer } from "@/components/sim/props/thermo";
import { Kettlebell } from "@/components/sim/props/mechanics";
import { Ground, LabBench, Tree } from "@/components/sim/props/environment";

const R_GAS = 8.314;
const T_PROC = 3;
const BASE_H = 1.6;
const HEIGHT_SCALE = 1.4;
const COLD = new THREE.Color("#38bdf8");
const HOT = new THREE.Color("#f87171");

type ProcessType = "T" | "P" | "V";

interface CurvePoint {
  V: number;
  P: number;
  [key: string]: number;
}
interface SamplePoint {
  t: number;
  Pn: number;
  Vn: number;
  Tn: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  P: number;
  V: number;
  T: number;
}

function stateAtK(process: ProcessType, k: number, P0: number, V0: number, T0: number) {
  if (process === "T") return { P: P0 / k, V: V0 * k, T: T0 };
  if (process === "P") return { P: P0, V: V0 * k, T: T0 * k };
  return { P: P0 * k, V: V0, T: T0 * k };
}

interface SceneContentProps {
  process: ProcessType;
  scenario: string;
  P0: number;
  V0: number;
  T0: number;
  k: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ process, scenario, P0, V0, T0, k, running, speed, onSample, onLive }: SceneContentProps) {
  const pistonRef = useRef<THREE.Group>(null!);
  const gasRef = useRef<THREE.Mesh>(null!);
  const gasMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const balloonRef = useRef<THREE.Group>(null!);
  const gauge = useRef(0);
  const thermo = useRef(0.5);
  const target = stateAtK(process, k, P0, V0, T0);
  const Tmin = Math.min(T0, target.T) - 40;
  const Tmax = Math.max(T0, target.T) + 40;
  const Pmax = Math.max(P0, target.P) * 1.2;
  const heating = target.T > T0 + 1;
  const cooling = target.T < T0 - 1;
  const syringe = scenario === "syringe";
  const balloon = scenario === "balloon";
  const cylR = syringe ? 0.42 : 1;

  const evalAt = useCallback(
    (t: number) => {
      const frac = Math.min(t / T_PROC, 1);
      const kt = 1 + (k - 1) * frac;
      return stateAtK(process, kt, P0, V0, T0);
    },
    [process, k, P0, V0, T0],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const { V, P, T } = evalAt(t);
      const h = BASE_H + ((V - V0) / V0) * HEIGHT_SCALE;
      if (gasRef.current) {
        gasRef.current.scale.y = h;
        gasRef.current.position.y = h / 2;
      }
      if (pistonRef.current) pistonRef.current.position.y = h;
      if (balloonRef.current) balloonRef.current.scale.setScalar(Math.cbrt(V / V0));
      if (gasMatRef.current) {
        const tt = Math.max(0, Math.min(1, (T - Tmin) / (Tmax - Tmin)));
        gasMatRef.current.color.copy(COLD).lerp(HOT, tt);
        gasMatRef.current.emissive.copy(COLD).lerp(HOT, tt);
      }
      gauge.current = Math.max(0, Math.min(1, P / Pmax));
      thermo.current = Math.max(0.05, Math.min(1, (T - 150) / 450));
    },
    [evalAt, V0, Tmin, Tmax, Pmax],
  );

  const ticker = (
    <PhysicsTicker
      running={running}
      speed={speed}
      onFrame={handleFrame}
      sampleHz={20}
      onSample={(t) => {
        const { V, P, T } = evalAt(t);
        onSample({ t, Pn: P / P0, Vn: V / V0, Tn: T / T0 });
        onLive({ t, P, V, T });
      }}
    />
  );

  if (balloon) {
    return (
      <>
        {ticker}
        <Ground kind="snow" from={-8} to={8} width={10} tile={4} tileZ={4} y={-0.01} />
        <Tree position={[-3.2, 0, -2.5]} height={3.2} seed={5} conifer />
        <Tree position={[3.6, 0, -3]} height={2.6} seed={11} conifer />
        {/* a weight on the ground holds the string */}
        <mesh position={[0, 0.08, 0]} castShadow>
          <boxGeometry args={[0.25, 0.16, 0.25]} />
          <meshStandardMaterial color="#334155" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.8, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 1.4, 4]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
        <group ref={balloonRef} position={[0, 2.35, 0]}>
          <mesh scale={[1, 1.18, 1]} castShadow>
            <sphereGeometry args={[0.8, 40, 30]} />
            <meshStandardMaterial color="#ef4444" roughness={0.25} metalness={0.05} />
          </mesh>
          <mesh position={[0, -0.98, 0]}>
            <coneGeometry args={[0.08, 0.14, 12]} />
            <meshStandardMaterial color="#b91c1c" roughness={0.4} />
          </mesh>
        </group>
        <SceneLabel position={[0, 3.9, 0]}>воздушный шарик</SceneLabel>
        <Thermometer position={[1.9, 0, 0.6]} levelRef={thermo} height={1.6} />
        <SceneLabel position={[1.9, 1.9, 0.6]}>уличный термометр</SceneLabel>
      </>
    );
  }

  return (
    <>
      {ticker}
      <LabBench position={[0, -1.35, 0]} length={6} depth={3} height={0.9} />
      {/* tripod lifts the cylinder above the burner */}
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        return (
          <mesh key={i} position={[Math.cos(a) * (cylR + 0.12), -0.225, Math.sin(a) * (cylR + 0.12)]}>
            <cylinderGeometry args={[0.025, 0.025, 0.45, 8]} />
            <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.3} />
          </mesh>
        );
      })}
      {/* glass cylinder (or syringe barrel) on a metal base */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[cylR + 0.2, cylR + 0.25, 0.08, 32]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, BASE_H * 1.5 / 2 + 0.6, 0]}>
        <cylinderGeometry args={[cylR + 0.04, cylR + 0.04, BASE_H * 1.5 + 1.2, 32, 1, true]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.14} side={THREE.DoubleSide} roughness={0.05} depthWrite={false} />
      </mesh>
      {syringe &&
        Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[0, 0.25 + i * 0.25, cylR + 0.045]}>
            <boxGeometry args={[i % 2 ? 0.12 : 0.22, 0.012, 0.004]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        ))}
      {syringe && (
        <>
          <mesh position={[0, -0.05, 0]}>
            <cylinderGeometry args={[0.12, 0.2, 0.18, 16]} />
            <meshStandardMaterial color="#f97316" roughness={0.6} />
          </mesh>
          <SceneLabel position={[0.9, 0.0, 0.3]}>носик заткнут пробкой</SceneLabel>
        </>
      )}
      <mesh ref={gasRef} position={[0, BASE_H / 2, 0]}>
        <cylinderGeometry args={[cylR, cylR, 1, 32]} />
        <meshStandardMaterial ref={gasMatRef} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.3} transparent opacity={0.45} roughness={0.4} depthWrite={false} />
      </mesh>
      <group ref={pistonRef} position={[0, BASE_H, 0]}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <cylinderGeometry args={[cylR + 0.02, cylR + 0.02, 0.16, 32]} />
          <meshStandardMaterial color={syringe ? "#111827" : "#a1a1aa"} metalness={syringe ? 0.1 : 0.7} roughness={0.35} />
        </mesh>
        <mesh position={[0, syringe ? 1.0 : 0.7, 0]}>
          <cylinderGeometry args={[syringe ? 0.07 : 0.06, syringe ? 0.07 : 0.06, syringe ? 1.85 : 1.25, 12]} />
          <meshStandardMaterial color={syringe ? "#e5e7eb" : "#d4d4d8"} metalness={syringe ? 0.1 : 0.9} roughness={0.3} />
        </mesh>
        {syringe ? (
          <mesh position={[0, 1.95, 0]}>
            <cylinderGeometry args={[0.38, 0.38, 0.05, 24]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.4} />
          </mesh>
        ) : process === "P" ? (
          <Kettlebell position={[0, 1.33, 0]} radius={0.28} label="груз" />
        ) : null}
        <SceneLabel position={[cylR + 0.95, 0.4, 0]}>
          {syringe ? "поршень шприца" : process === "P" ? "груз держит давление постоянным" : process === "V" ? "поршень закреплён" : "поршень"}
        </SceneLabel>
      </group>
      {process === "V" && !syringe && (
        <>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (cylR + 0.12), BASE_H + 0.27, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.4, 10]} />
              <meshStandardMaterial color="#ef4444" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </>
      )}
      {process === "T" && !syringe && (
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[cylR + 0.45, cylR + 0.45, 1.0, 32, 1, true]} />
          <meshStandardMaterial color="#0ea5e9" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {process === "T" && !syringe && <SceneLabel position={[-cylR - 0.8, 1.15, 0.6]}>водяная баня: T = const</SceneLabel>}
      {!syringe && heating && <Burner position={[0, -0.45, 0]} power={1} />}
      {!syringe && heating && <SceneLabel position={[0.9, -0.3, 0.8]}>нагреваем</SceneLabel>}
      {!syringe && cooling &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * (cylR + 0.4), 0.2, 0.3]} rotation={[0.3, s, 0.2]}>
            <boxGeometry args={[0.3, 0.3, 0.3]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.85} roughness={0.08} />
          </mesh>
        ))}
      {!syringe && cooling && <SceneLabel position={[cylR + 0.5, 0.7, 0.6]}>охлаждаем льдом</SceneLabel>}
      <mesh position={[cylR + 0.55, 1.0, -0.2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, 0.6, 8]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.25} />
      </mesh>
      <DialGauge position={[cylR + 1.05, 1.0, -0.2]} label="P" valueRef={gauge} radius={0.36} />
      <Thermometer position={[-cylR - 0.75, -0.45, -0.4]} levelRef={thermo} height={1.9} />
    </>
  );
}

const PROCESS_LABEL: Record<ProcessType, string> = { T: "Изотермический (T=const)", P: "Изобарный (P=const)", V: "Изохорный (V=const)" };

export function IsoprocessesSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, process, n, T0, P0init, k, kBalloon } = useControls("Изопроцессы", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Цилиндр с поршнем": "abstract", "Шприц (изотерма)": "syringe", "Шарик на морозе": "balloon" },
    },
    process: {
      value: "T",
      options: { Изотермический: "T", Изобарный: "P", Изохорный: "V" },
      label: "Процесс",
      render: (get) => get("Изопроцессы.scenario") === "abstract",
    },
    n: { value: 1, min: 0.5, max: 3, step: 0.1, label: "n, моль" },
    T0: { value: 300, min: 200, max: 500, step: 10, label: "T₀, К", render: (get) => get("Изопроцессы.scenario") !== "balloon" },
    P0init: { value: 150, min: 50, max: 300, step: 10, label: "P₀, кПа" },
    k: {
      value: 1.8,
      min: 0.4,
      max: 2.5,
      step: 0.05,
      label: "k (во сколько раз растёт вед. величина)",
      render: (get) => get("Изопроцессы.scenario") === "abstract",
    },
    kBalloon: {
      value: 0.75,
      min: 0.5,
      max: 0.95,
      step: 0.01,
      label: "T_улицы / T_комнаты",
      render: (get) => get("Изопроцессы.scenario") === "balloon",
    },
  });

  const effProcess: ProcessType = scenario === "syringe" ? "T" : scenario === "balloon" ? "P" : (process as ProcessType);
  const effK = scenario === "syringe" ? 0.35 : scenario === "balloon" ? kBalloon : k;
  const effT0 = scenario === "balloon" ? 293 : T0;

  const P0 = P0init * 1000;
  const V0 = (n * R_GAS * effT0) / P0;

  const target = stateAtK(effProcess, effK, P0, V0, effT0);

  const curve = useMemo(() => {
    const pts: CurvePoint[] = [];
    for (let i = 0; i <= 40; i++) {
      const kk = 0.4 + ((2.5 - 0.4) * i) / 40;
      const s = stateAtK(effProcess, kk, P0, V0, effT0);
      pts.push({ V: Number((s.V * 1000).toFixed(3)), P: Number((s.P / 1000).toFixed(2)) });
    }
    return pts;
  }, [effProcess, P0, V0, effT0]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, P: P0, V: V0, T: effT0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, Pn: 1, Vn: 1, Tn: 1 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, P: P0, V: V0, T: effT0 });
    setSeries([{ t: 0, Pn: 1, Vn: 1, Tn: 1 }]);
  }, [P0, V0, effT0]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const paramKey = `${scenario}|${process}|${n}|${T0}|${P0init}|${k}|${kBalloon}`;
  const firstParams = useRef(paramKey);
  useEffect(() => {
    if (firstParams.current === paramKey) return;
    firstParams.current = paramKey;
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const f1 = (x: number) => x.toFixed(1).replace(".", ",");
  let caption;
  if (scenario === "syringe") {
    caption = (
      <>
        <b>Шприц с заткнутым носиком:</b> давим на поршень медленно, газ успевает остывать до комнатной температуры (T = const). Объём уменьшился до {f1(live.V * 1000)} л — давление выросло до{" "}
        {f1(live.P / 1000)} кПа: PV = const (закон Бойля—Мариотта). Чем сильнее сжимаешь, тем сильнее воздух упирается в палец.
      </>
    );
  } else if (scenario === "balloon") {
    caption = (
      <>
        <b>Шарик вынесли на мороз:</b> температура воздуха внутри падает до {f1(live.T - 273)} °C, давление снаружи то же (атмосферное) — поэтому объём уменьшается: V/T = const. Из шарика ничего не
        вышло, просто молекулы стали медленнее.
      </>
    );
  } else if (effProcess === "T") {
    caption = <><b>Изотермический процесс:</b> водяная баня держит температуру постоянной, поршень двигают медленно. PV = const — на графике гипербола. Сейчас P = {f1(live.P / 1000)} кПа, V = {f1(live.V * 1000)} л.</>;
  } else if (effProcess === "P") {
    caption = <><b>Изобарный процесс:</b> груз на поршне всё время давит одинаково — P = const. {target.T > effT0 ? "Газ нагревают горелкой — он расширяется и поднимает поршень" : "Газ охлаждают — он сжимается и поршень опускается"}: V/T = const (закон Гей-Люссака).</>;
  } else {
    caption = <><b>Изохорный процесс:</b> поршень закреплён — объём не меняется. {target.T > effT0 ? "Нагреваем — молекулы бьют сильнее, манометр растёт" : "Охлаждаем — давление падает"}: P/T = const (закон Шарля).</>;
  }
  const legend: LegendItem[] = [
    { color: "#38bdf8", label: "холодный газ", kind: "square" },
    { color: "#f87171", label: "горячий газ", kind: "square" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: [4.2, 3.0, 6.4] as [number, number, number], fov: 50 }} orbitTarget={[0.3, 1.3, 0]} simplified={isMobile} maxDistance={18} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={clock.resetNonce} process={effProcess} scenario={scenario} P0={P0} V0={V0} T0={effT0} k={effK} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
        </SceneCanvas>
      }
      legend={scenario === "balloon" ? [] : legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: "Процесс", value: PROCESS_LABEL[effProcess] },
            { label: "P(t)", value: (live.P / 1000).toFixed(1), unit: "кПа" },
            { label: "V(t)", value: (live.V * 1000).toFixed(2), unit: "л" },
            { label: "T(t)", value: live.T.toFixed(1), unit: "К" },
            { label: "Конечное P₂", value: (target.P / 1000).toFixed(1), unit: "кПа" },
            { label: "Конечное V₂", value: (target.V * 1000).toFixed(2), unit: "л" },
            { label: "Конечное T₂", value: target.T.toFixed(1), unit: "К" },
          ]}
        />
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Диаграмма P–V для выбранного процесса</p>
            <LiveChart data={curve} xKey="V" xLabel="V, л" series={[{ key: "P", color: "#4ade80", label: "P, кПа" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Относительные P/P₀, V/V₀, T/T₀ во времени</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "Pn", color: "#4ade80", label: "P/P₀" }, { key: "Vn", color: "#fbbf24", label: "V/V₀" }, { key: "Tn", color: "#f87171", label: "T/T₀" }]} />
          </div>
        </div>
      }
      note={
        scenario === "syringe" ? (
          <>
            Носик шприца заткнут — газ никуда не выходит, но температура успевает выровняться с окружающей
            (медленное сжатие рукой) — это изотермический процесс: PV=const. Толкая поршень, вы уменьшаете V —
            и P растёт по гиперболе.
          </>
        ) : scenario === "balloon" ? (
          <>
            Шарик на морозе окружён атмосферным давлением снаружи — P≈const (изобарный процесс), поэтому
            работает закон Гей-Люссака V/T=const. Похолодание снижает T, и объём воздуха внутри уменьшается
            пропорционально — шарик заметно «сдувается», хотя из него ничего не вышло.
          </>
        ) : (
          <>
            Уравнение Клапейрона PV=nRT связывает три величины; в изопроцессе одна остаётся постоянной.
            Изотермический: PV=const (гипербола); изобарный: V/T=const (закон Гей-Люссака); изохорный:
            P/T=const (закон Шарля). Кривая на графике P–V меняет форму при смене типа процесса.
          </>
        )
      }
    />
  );
}
