import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LabBench } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const R_GAS = 8.314;
const GAMMA = 5 / 3;
const STAGE_T = 2;
const CYCLE_T = STAGE_T * 4;
const BASE_H = 1.4;
const HEIGHT_SCALE = 1.2;
const COLD = new THREE.Color("#38bdf8");
const HOT = new THREE.Color("#f87171");

const STAGE_NAMES = ["1→2 изотерм. расширение (Tг)", "2→3 адиабат. расширение", "3→4 изотерм. сжатие (Tх)", "4→1 адиабат. сжатие"];
const STAGE_NAMES_REVERSE = ["2→1 изотерм. сжатие, отдача Qг (Tг)", "3→2 адиабат. сжатие", "4→3 изотерм. расширение, приём Qх (Tх)", "1→4 адиабат. расширение"];

interface CyclePoint {
  V: number;
  P: number;
  [key: string]: number;
}
interface SamplePoint {
  t: number;
  Pn: number;
  Vn: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  P: number;
  V: number;
  T: number;
  stage: number;
}

interface CycleParams {
  Th: number;
  Tc: number;
  n: number;
  V1: number;
  V2: number;
  V3: number;
  V4: number;
  P1: number;
  P2: number;
  P3: number;
  P4: number;
}

function computeCycle(Th: number, Tc: number, n: number, V1: number, expRatio: number): CycleParams {
  const V2 = V1 * expRatio;
  const ratio = Math.pow(Th / Tc, 1 / (GAMMA - 1));
  const V3 = V2 * ratio;
  const V4 = V1 * ratio;
  const P1 = (n * R_GAS * Th) / V1;
  const P2 = (n * R_GAS * Th) / V2;
  const P3 = (n * R_GAS * Tc) / V3;
  const P4 = (n * R_GAS * Tc) / V4;
  return { Th, Tc, n, V1, V2, V3, V4, P1, P2, P3, P4 };
}

function stateAtPhase(c: CycleParams, phase: number) {
  const stage = Math.min(3, Math.floor(phase * 4));
  const tau = phase * 4 - stage;
  if (stage === 0) {
    const V = c.V1 + (c.V2 - c.V1) * tau;
    return { V, P: (c.n * R_GAS * c.Th) / V, T: c.Th, stage };
  }
  if (stage === 1) {
    const V = c.V2 + (c.V3 - c.V2) * tau;
    return { V, P: c.P2 * Math.pow(c.V2 / V, GAMMA), T: c.Th * Math.pow(c.V2 / V, GAMMA - 1), stage };
  }
  if (stage === 2) {
    const V = c.V3 + (c.V4 - c.V3) * tau;
    return { V, P: (c.n * R_GAS * c.Tc) / V, T: c.Tc, stage };
  }
  const V = c.V4 + (c.V1 - c.V4) * tau;
  return { V, P: c.P4 * Math.pow(c.V4 / V, GAMMA), T: c.Tc * Math.pow(c.V4 / V, GAMMA - 1), stage };
}

interface SceneContentProps {
  cycle: CycleParams;
  reverse: boolean;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/** where the cylinder stands during each stage: hot plate, insulating pad, cold block, insulating pad */
const STATION_X = [-2.3, 0, 2.3, 0];

function SceneContent({ cycle, reverse, running, speed, onSample, onLive }: SceneContentProps) {
  const rig = useRef<THREE.Group>(null!);
  const pistonRef = useRef<THREE.Group>(null!);
  const gasRef = useRef<THREE.Mesh>(null!);
  const gasMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const wheel = useRef<THREE.Group>(null!);
  const heatIn = useRef<VectorArrowHandle>(null);
  const heatOut = useRef<VectorArrowHandle>(null);
  const prevStage = useRef(0);
  const fromX = useRef(STATION_X[0]);

  const handleFrame = useCallback(
    (t: number) => {
      const frac = (t % CYCLE_T) / CYCLE_T;
      const phase = reverse ? 1 - frac : frac;
      const { V, T, stage } = stateAtPhase(cycle, phase);
      const tau = phase * 4 - stage;
      const h = BASE_H + ((V - cycle.V1) / cycle.V1) * HEIGHT_SCALE;
      if (gasRef.current) {
        gasRef.current.scale.y = h;
        gasRef.current.position.y = 0.3 + h / 2;
      }
      if (pistonRef.current) pistonRef.current.position.y = 0.3 + h;
      if (gasMatRef.current) {
        const tt = Math.max(0, Math.min(1, (T - cycle.Tc) / (cycle.Th - cycle.Tc)));
        gasMatRef.current.color.copy(COLD).lerp(HOT, tt);
        gasMatRef.current.emissive.copy(COLD).lerp(HOT, tt);
      }
      // slide the cylinder to the station of the current stage during the first part of the stage
      if (stage !== prevStage.current) {
        fromX.current = rig.current?.position.x ?? STATION_X[stage];
        prevStage.current = stage;
      }
      const k = Math.min(1, (reverse ? 1 - tau : tau) / 0.18);
      const x = THREE.MathUtils.lerp(fromX.current, STATION_X[stage], k * k * (3 - 2 * k));
      if (rig.current) rig.current.position.x = x;
      if (wheel.current) wheel.current.rotation.z = -frac * Math.PI * 2 * (reverse ? -1 : 1);
      const settled = k >= 1;
      // heat flow: into the gas from the hot plate (engine) / out of it into the hot plate (fridge), and so on
      const hotHeat = settled && stage === 0;
      const coldHeat = settled && stage === 2;
      const intoGas = (hotHeat && !reverse) || (coldHeat && reverse);
      if (hotHeat || coldHeat) {
        const y0 = intoGas ? -0.15 : 0.45;
        heatIn.current?.set([x - 0.3, y0, 0.9], [0, intoGas ? 0.55 : -0.55, 0]);
        heatOut.current?.set([x + 0.3, y0, 0.9], [0, intoGas ? 0.55 : -0.55, 0]);
      } else {
        heatIn.current?.hide();
        heatOut.current?.hide();
      }
    },
    [cycle, reverse],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const frac = (t % CYCLE_T) / CYCLE_T;
          const phase = reverse ? 1 - frac : frac;
          const { V, P, T, stage } = stateAtPhase(cycle, phase);
          onSample({ t, Pn: P / cycle.P1, Vn: V / cycle.V1 });
          onLive({ t, P, V, T, stage });
        }}
      />
      <LabBench position={[0, -0.95, 0]} length={7.5} depth={3} height={0.9} />
      {/* hot reservoir, insulating pad, cold reservoir */}
      <mesh position={[STATION_X[0], -0.03, 0]}>
        <boxGeometry args={[1.6, 0.12, 1.6]} />
        <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={0.8} roughness={0.5} />
      </mesh>
      <SceneLabel position={[STATION_X[0], 0.1, 1.15]} tone="#ef4444">{`нагреватель Tг = ${cycle.Th.toFixed(0)} К`}</SceneLabel>
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[1.6, 0.12, 1.6]} />
        <meshStandardMaterial color="#a8a29e" roughness={0.95} />
      </mesh>
      <SceneLabel position={[0, 0.1, 1.15]}>теплоизолятор (Q = 0)</SceneLabel>
      <mesh position={[STATION_X[2], -0.03, 0]}>
        <boxGeometry args={[1.6, 0.12, 1.6]} />
        <meshStandardMaterial color="#1e3a8a" emissive="#38bdf8" emissiveIntensity={0.5} roughness={0.3} />
      </mesh>
      <SceneLabel position={[STATION_X[2], 0.1, 1.15]} tone="#38bdf8">{`холодильник Tх = ${cycle.Tc.toFixed(0)} К`}</SceneLabel>

      <group ref={rig} position={[STATION_X[0], 0, 0]}>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.7, 0.72, 0.3, 32]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.3 + BASE_H * 1.25, 0]}>
          <cylinderGeometry args={[0.62, 0.62, BASE_H * 2.5, 32, 1, true]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh ref={gasRef} position={[0, 0.3 + BASE_H / 2, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 1, 32]} />
          <meshStandardMaterial ref={gasMatRef} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.35} transparent opacity={0.5} roughness={0.4} depthWrite={false} />
        </mesh>
        <group ref={pistonRef} position={[0, 0.3 + BASE_H, 0]}>
          <mesh position={[0, 0.07, 0]} castShadow>
            <cylinderGeometry args={[0.64, 0.64, 0.14, 32]} />
            <meshStandardMaterial color="#a1a1aa" metalness={0.75} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.9, 12]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
          </mesh>
        </group>
      </group>
      {/* flywheel: driven by the piston (engine) or by a motor (fridge) */}
      <group position={[0, 3.6, -1.2]}>
        <group ref={wheel}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.55, 0.55, 0.12, 32]} />
            <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.42, 0.07]}>
            <boxGeometry args={[0.08, 0.2, 0.02]} />
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.6} />
          </mesh>
        </group>
        <SceneLabel position={[0.95, 0.4, 0]}>{reverse ? "мотор крутит маховик (тратим работу W)" : "маховик: полезная работа W"}</SceneLabel>
      </group>
      <VectorArrow ref={heatIn} color="#fb923c" shaftRadius={0.05} headRadius={0.12} />
      <VectorArrow ref={heatOut} color="#fb923c" shaftRadius={0.05} headRadius={0.12} />
    </>
  );
}

export function HeatEnginesCarnotSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { direction, Th, Tc, n, V1init, expRatio } = useControls("Цикл Карно", {
    direction: {
      value: "forward",
      label: "Направление цикла",
      options: { "Прямой (тепловой двигатель)": "forward", "Обратный (холодильник/тепловой насос)": "reverse" },
    },
    Th: { value: 600, min: 400, max: 900, step: 10, label: "Tг, К (нагреватель)" },
    Tc: { value: 300, min: 200, max: 350, step: 10, label: "Tх, К (холодильник)" },
    n: { value: 1, min: 0.5, max: 2, step: 0.1, label: "n, моль" },
    V1init: { value: 4, min: 2, max: 6, step: 0.5, label: "V₁, л" },
    expRatio: { value: 1.8, min: 1.3, max: 2.5, step: 0.05, label: "V₂/V₁ (расширение)" },
  });
  const reverse = direction === "reverse";

  const cycle = useMemo(() => computeCycle(Th, Tc, n, V1init / 1000, expRatio), [Th, Tc, n, V1init, expRatio]);

  const Qh = n * R_GAS * Th * Math.log(cycle.V2 / cycle.V1);
  const Qc = n * R_GAS * Tc * Math.log(cycle.V2 / cycle.V1);
  const Wtotal = Qh - Qc;
  const eta = 1 - Tc / Th;
  const copFridge = Qc / Wtotal; // холодильник: тепло, отобранное у холодного, на единицу затраченной работы
  const copHeatPump = Qh / Wtotal; // тепловой насос: тепло, доставленное горячему, на единицу затраченной работы

  const curve = useMemo(() => {
    const pts: CyclePoint[] = [];
    const n1 = 12;
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i <= n1; i++) {
        const phase = (s + i / n1) / 4;
        const { V, P } = stateAtPhase(cycle, Math.min(phase, 0.999999));
        pts.push({ V: Number((V * 1000).toFixed(3)), P: Number((P / 1000).toFixed(2)) });
      }
    }
    return pts;
  }, [cycle]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, P: cycle.P1, V: cycle.V1, T: Th, stage: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, Pn: 1, Vn: 1 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, P: cycle.P1, V: cycle.V1, T: Th, stage: 0 });
    setSeries([{ t: 0, Pn: 1, Vn: 1 }]);
  }, [cycle, Th]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const STAGE_TEXT = reverse
    ? [
        "Цилиндр на горячей плите: газ сжимают, и он отдаёт тепло Qг «горячей стороне» (в комнату / наружу).",
        "Теплоизолятор: газ сжимают без обмена теплом — он нагревается до Tг.",
        "Цилиндр на холодном блоке: газ расширяется и забирает тепло Qх у холодной стороны — так холодильник охлаждает продукты.",
        "Теплоизолятор: газ расширяется без обмена теплом и остывает до Tх.",
      ]
    : [
        "Цилиндр на горячем нагревателе: газ получает тепло Qг, расширяется при постоянной температуре и толкает поршень.",
        "Теплоизолятор: газ продолжает расширяться без притока тепла — он совершает работу за счёт своей энергии и остывает.",
        "Цилиндр на холодильнике: газ сжимают, лишнее тепло Qх уходит в холодильник. Без этого двигатель работать не может.",
        "Теплоизолятор: газ сжимают без отдачи тепла — он нагревается обратно до Tг, и цикл повторяется.",
      ];
  const caption = (
    <>
      <b>Стадия {live.stage + 1} из 4.</b> {STAGE_TEXT[live.stage]}{" "}
      {reverse ? `На 1 Дж работы мотора холодильник выкачивает ${copFridge.toFixed(1).replace(".", ",")} Дж тепла.` : `КПД = 1 − Tх/Tг = ${(eta * 100).toFixed(0)}%.`}
    </>
  );
  const legend: LegendItem[] = [
    { color: "#fb923c", label: "поток тепла Q" },
    { color: "#38bdf8", label: "холодный газ", kind: "square" },
    { color: "#f87171", label: "горячий газ", kind: "square" },
  ];

  const maxAbs = Math.max(Qh, Qc, Wtotal, 1);
  const barPct = (v: number) => Math.min(100, (Math.abs(v) / maxAbs) * 100);

  return (
    <SimShell
      scene={
        <SceneCanvas camera={{ position: [0.5, 3.4, 8.2] as [number, number, number], fov: 50 }} orbitTarget={[0, 1.4, 0]} simplified={isMobile} maxDistance={18} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={clock.resetNonce} cycle={cycle} reverse={reverse} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <div className="flex flex-col gap-3">
          <NumberReadouts
            items={[
              { label: "Стадия", value: (reverse ? STAGE_NAMES_REVERSE : STAGE_NAMES)[live.stage] },
              { label: "P(t)", value: (live.P / 1000).toFixed(1), unit: "кПа" },
              { label: "V(t)", value: (live.V * 1000).toFixed(2), unit: "л" },
              { label: "T(t)", value: live.T.toFixed(0), unit: "К" },
              reverse
                ? { label: "COP холодильника = Qх/W", value: copFridge.toFixed(2), unit: "×" }
                : { label: "КПД η=1−Tх/Tг", value: (eta * 100).toFixed(1), unit: "%" },
              ...(reverse ? [{ label: "COP теплового насоса = Qг/W", value: copHeatPump.toFixed(2), unit: "×" }] : []),
            ]}
          />
          <div className="rounded-xl border border-border bg-surface-2/60 p-4">
            <p className="mb-3 text-xs font-medium text-muted-2">{reverse ? "Qх + W = Qг (за цикл)" : "Qг = W + Qх (за цикл)"}</p>
            <div className="flex h-28 items-end justify-center gap-6">
              {[
                { label: "Qг", v: Qh, color: "#f87171" },
                { label: "W", v: Wtotal, color: "#4ade80" },
                { label: "Qх", v: Qc, color: "#38bdf8" },
              ].map((b) => (
                <div key={b.label} className="flex h-full w-14 flex-col items-center gap-1.5">
                  <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-t-md bg-surface">
                    <div className="w-full rounded-t-md transition-[height] duration-150" style={{ height: `${barPct(b.v)}%`, background: b.color }} />
                  </div>
                  <span className="text-center font-mono text-[11px] tabular-nums text-muted-2">
                    {b.label} {b.v.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Цикл Карно на диаграмме P–V</p>
            <LiveChart data={curve} xKey="V" xType="number" xLabel="V, л" series={[{ key: "P", color: "#4ade80", label: "P, кПа" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">P/P₁ и V/V₁ за один цикл</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "Pn", color: "#4ade80", label: "P/P₁" }, { key: "Vn", color: "#fbbf24", label: "V/V₁" }]} />
          </div>
        </div>
      }
      note={
        reverse ? (
          <>
            Обратный цикл Карно — тот же цикл, пройденный в обратном направлении: теперь работа W затрачивается
            извне (например, компрессором), чтобы забрать тепло Qх у холодного резервуара и передать Qг=W+Qх
            горячему. Если холодный резервуар — это внутренность холодильника, а горячий — кухня, машина
            работает холодильником (COP=Qх/W). Если холодный резервуар — улица, а горячий — комната, та же
            машина работает тепловым насосом (COP=Qг/W) — и COP теплового насоса всегда на 1 больше COP
            холодильника при тех же Tг, Tх, потому что Qг=Qх+W.
          </>
        ) : (
          <>
            Идеальный цикл Карно: изотермическое расширение при Tг (поглощение Qг), адиабатическое
            расширение, изотермическое сжатие при Tх (отдача Qх), адиабатическое сжатие. КПД зависит только
            от температур: η=1−Tх/Tг — максимально возможный КПД теплового двигателя между этими резервуарами.
          </>
        )
      }
    />
  );
}
