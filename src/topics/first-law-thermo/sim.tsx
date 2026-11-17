import { useCallback, useEffect, useRef, useState } from "react";
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
import { Burner, Thermometer } from "@/components/sim/props/thermo";
import { Kettlebell, Rod, type RodHandle } from "@/components/sim/props/mechanics";
import { Ground, LabBench } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const R_GAS = 8.314;
const T_PROC = 3;
const BASE_H = 1.6;
const HEIGHT_SCALE = 1.4;
const COLD = new THREE.Color("#38bdf8");
const HOT = new THREE.Color("#f87171");

interface SamplePoint {
  t: number;
  V: number;
  T: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  V: number;
  T: number;
}

interface SceneContentProps {
  V1: number;
  V2: number;
  T0: number;
  T2: number;
  ignitionT?: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

const HEAD_Y = 3.2;
const CRANK_Y = -0.9;
const CRANK_R = 0.55;
const ROD_L = 1.9;

/** slider-crank: piston pin height for crank angle θ (0 = top dead centre) */
function pinHeight(theta: number) {
  return CRANK_Y + CRANK_R * Math.cos(theta) + Math.sqrt(ROD_L * ROD_L - (CRANK_R * Math.sin(theta)) ** 2);
}

function SceneContent({ V1, V2, T0, T2, ignitionT, running, speed, onSample, onLive }: SceneContentProps) {
  const diesel = ignitionT !== undefined;
  const pistonRef = useRef<THREE.Group>(null!);
  const gasRef = useRef<THREE.Mesh>(null!);
  const gasMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const flashRef = useRef<THREE.PointLight>(null!);
  const flame = useRef<THREE.Mesh>(null!);
  const crank = useRef<THREE.Group>(null!);
  const rod = useRef<RodHandle>(null);
  const thermo = useRef(0.4);
  const Tmin = Math.min(T0, T2) - 40;
  const Tmax = Math.max(T0, T2) + 40;
  const heating = T2 > T0 + 1;
  const cooling = T2 < T0 - 1;

  // engine geometry: gas fills from the piston crown up to the cylinder head
  const pinBottom = pinHeight(Math.PI);
  const crownOffset = 0.35;
  const minGap = 0.12;

  const stateAt = useCallback(
    (t: number) => {
      const frac = Math.min(t / T_PROC, 1);
      const V = V1 + (V2 - V1) * frac;
      const T = T0 + (T2 - T0) * frac;
      return { V, T };
    },
    [V1, V2, T0, T2],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const { V, T } = stateAt(t);
      if (diesel) {
        // gas height proportional to its volume; find the crank angle that puts the piston there
        const gapMax = HEAD_Y - (pinBottom + crownOffset);
        const gap = minGap + (gapMax - minGap) * ((V - V2) / (V1 - V2));
        const pinY = HEAD_Y - gap - crownOffset;
        let lo = 0;
        let hi = Math.PI;
        for (let i = 0; i < 30; i++) {
          const mid = (lo + hi) / 2;
          if (pinHeight(mid) > pinY) lo = mid;
          else hi = mid;
        }
        const theta = (lo + hi) / 2;
        if (pistonRef.current) pistonRef.current.position.y = pinY;
        if (crank.current) crank.current.rotation.z = theta;
        rod.current?.set([CRANK_R * Math.sin(theta), CRANK_Y + CRANK_R * Math.cos(theta), 0.35], [0, pinY, 0.35]);
        if (gasRef.current) {
          gasRef.current.scale.y = gap;
          gasRef.current.position.y = HEAD_Y - gap / 2;
        }
        const ignited = T >= (ignitionT ?? Infinity);
        if (flame.current) {
          flame.current.visible = ignited;
          flame.current.position.y = HEAD_Y - gap / 2;
          flame.current.scale.set(1, Math.max(0.1, gap), 1);
        }
        if (flashRef.current) flashRef.current.intensity = ignited ? 4 : 0;
      } else {
        const h = BASE_H + ((V - V1) / V1) * HEIGHT_SCALE;
        if (gasRef.current) {
          gasRef.current.scale.y = h;
          gasRef.current.position.y = h / 2;
        }
        if (pistonRef.current) pistonRef.current.position.y = h;
      }
      if (gasMatRef.current) {
        const tt = Math.max(0, Math.min(1, (T - Tmin) / (Tmax - Tmin)));
        gasMatRef.current.color.copy(COLD).lerp(HOT, tt);
        gasMatRef.current.emissive.copy(COLD).lerp(HOT, tt);
      }
      thermo.current = Math.max(0.05, Math.min(1, (T - 200) / (diesel ? 900 : 450)));
    },
    [stateAt, diesel, V1, V2, Tmin, Tmax, ignitionT, pinBottom],
  );

  const ticker = (
    <PhysicsTicker
      running={running}
      speed={speed}
      onFrame={handleFrame}
      sampleHz={20}
      onSample={(t) => {
        const { V, T } = stateAt(t);
        onSample({ t, V, T });
        onLive({ t, V, T });
      }}
    />
  );

  if (diesel) {
    return (
      <>
        {ticker}
        <Ground kind="concrete" from={-5} to={5} width={6} tile={2} tileZ={2} y={CRANK_Y - 1.1} />
        {/* crankcase */}
        <mesh position={[0, CRANK_Y - 0.15, -0.2]} castShadow>
          <boxGeometry args={[2.6, 1.9, 1.3]} />
          <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.45} transparent opacity={0.35} depthWrite={false} />
        </mesh>
        {/* cylinder (cut open) with cooling fins */}
        <mesh position={[0, (HEAD_Y + pinBottom) / 2 + 0.1, 0]}>
          <cylinderGeometry args={[0.85, 0.85, HEAD_Y - pinBottom + 0.2, 36, 1, true, Math.PI * 0.15, Math.PI * 1.7]} />
          <meshStandardMaterial color="#71717a" metalness={0.75} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} position={[0, pinBottom + 0.5 + i * 0.4, 0]}>
            <cylinderGeometry args={[1.05, 1.05, 0.05, 36, 1, true, Math.PI * 0.15, Math.PI * 1.7]} />
            <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
        ))}
        {/* cylinder head with the fuel injector */}
        <mesh position={[0, HEAD_Y + 0.15, 0]} castShadow>
          <cylinderGeometry args={[0.95, 0.95, 0.3, 36]} />
          <meshStandardMaterial color="#52525b" metalness={0.75} roughness={0.35} />
        </mesh>
        <mesh position={[0, HEAD_Y + 0.5, 0]}>
          <cylinderGeometry args={[0.09, 0.12, 0.5, 14]} />
          <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.25} />
        </mesh>
        <SceneLabel position={[0.5, HEAD_Y + 0.95, 0]}>форсунка (впрыск топлива)</SceneLabel>
        <mesh ref={gasRef} position={[0, HEAD_Y - 1, 0]}>
          <cylinderGeometry args={[0.78, 0.78, 1, 32]} />
          <meshStandardMaterial ref={gasMatRef} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.35} transparent opacity={0.5} roughness={0.4} depthWrite={false} />
        </mesh>
        <mesh ref={flame} visible={false}>
          <cylinderGeometry args={[0.7, 0.7, 1, 24]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.75} toneMapped={false} />
        </mesh>
        <pointLight ref={flashRef} position={[0, HEAD_Y - 0.3, 1]} color="#fbbf24" intensity={0} distance={7} />
        <group ref={pistonRef}>
          <mesh position={[0, crownOffset / 2 + 0.02, 0]} castShadow>
            <cylinderGeometry args={[0.8, 0.8, crownOffset + 0.04, 32]} />
            <meshStandardMaterial color="#a1a1aa" metalness={0.85} roughness={0.3} />
          </mesh>
          {[0.25, 0.32].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <torusGeometry args={[0.8, 0.012, 6, 32]} />
              <meshStandardMaterial color="#27272a" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          <SceneLabel position={[1.3, 0.2, 0]}>поршень</SceneLabel>
        </group>
        <Rod ref={rod} radius={0.08} color="#9ca3af" metal />
        <group ref={crank} position={[0, CRANK_Y, 0.35]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[CRANK_R + 0.15, CRANK_R + 0.15, 0.18, 28]} />
            <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0, CRANK_R, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.1, 14]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
          </mesh>
        </group>
        <SceneLabel position={[1.4, CRANK_Y, 0.4]}>коленвал</SceneLabel>
        <Thermometer position={[1.7, CRANK_Y - 1.1, 0.5]} levelRef={thermo} height={2} />
      </>
    );
  }

  return (
    <>
      {ticker}
      <LabBench position={[0, -1.35, 0]} length={6} depth={3} height={0.9} />
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.12, -0.225, Math.sin(a) * 1.12]}>
            <cylinderGeometry args={[0.025, 0.025, 0.45, 8]} />
            <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.3} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <cylinderGeometry args={[1.2, 1.25, 0.08, 32]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, BASE_H * 1.5, 0]}>
        <cylinderGeometry args={[1.05, 1.05, BASE_H * 3, 32, 1, true]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.14} side={THREE.DoubleSide} roughness={0.05} depthWrite={false} />
      </mesh>
      <mesh ref={gasRef} position={[0, BASE_H / 2, 0]}>
        <cylinderGeometry args={[1, 1, 1, 32]} />
        <meshStandardMaterial ref={gasMatRef} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.35} transparent opacity={0.5} roughness={0.4} depthWrite={false} />
      </mesh>
      <group ref={pistonRef} position={[0, BASE_H, 0]}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <cylinderGeometry args={[1.08, 1.08, 0.16, 32]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 1.25, 12]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.3} />
        </mesh>
        <Kettlebell position={[0, 1.33, 0]} radius={0.28} label="груз" />
        <SceneLabel position={[1.9, 0.4, 0]}>груз на поршне: P = const</SceneLabel>
      </group>
      {heating && <Burner position={[0, -0.45, 0]} power={1} />}
      {heating && <SceneLabel position={[1.0, -0.2, 0.9]}>подводим тепло Q</SceneLabel>}
      {cooling &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * 1.45, 0.2, 0.3]} rotation={[0.3, s, 0.2]}>
            <boxGeometry args={[0.3, 0.3, 0.3]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.85} roughness={0.08} />
          </mesh>
        ))}
      {cooling && <SceneLabel position={[1.5, 0.7, 0.6]}>отводим тепло льдом</SceneLabel>}
      <Thermometer position={[-1.8, -0.45, -0.4]} levelRef={thermo} height={1.9} />
    </>
  );
}

export function FirstLawThermoSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, n, T0, P, Q, compRatio } = useControls("Первое начало термодинамики", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Цилиндр с грузом: нагрев при P = const": "abstract", "Дизель: сжатие без свечи зажигания": "diesel" },
    },
    n: { value: 1, min: 0.5, max: 3, step: 0.1, label: "n, моль" },
    T0: { value: 300, min: 200, max: 500, step: 10, label: "T₀, К", render: (get) => get("Первое начало термодинамики.scenario") === "abstract" },
    P: { value: 150, min: 50, max: 300, step: 10, label: "P, кПа (изобарный процесс)", render: (get) => get("Первое начало термодинамики.scenario") === "abstract" },
    Q: { value: 400, min: -600, max: 600, step: 20, label: "Q, Дж (тепло, +нагрев/−охлаждение)", render: (get) => get("Первое начало термодинамики.scenario") === "abstract" },
    compRatio: { value: 18, min: 10, max: 22, step: 1, label: "Степень сжатия V₁/V₂", render: (get) => get("Первое начало термодинамики.scenario") === "diesel" },
  });

  const diesel = scenario === "diesel";
  const GAMMA_AIR = 1.4;
  const Ppa = P * 1000;
  const Cv = 1.5 * R_GAS;
  const Cp = 2.5 * R_GAS;

  const V1abs = (n * R_GAS * T0) / Ppa;
  const dT = Q / (n * Cp);
  const T2abs = T0 + dT;
  const V2abs = (n * R_GAS * T2abs) / Ppa;
  const dUabs = n * Cv * dT;
  const Wabs = Ppa * (V2abs - V1abs);

  const T0Diesel = 300;
  const P0Diesel = 100000;
  const V1Diesel = (n * R_GAS * T0Diesel) / P0Diesel;
  const V2Diesel = V1Diesel / compRatio;
  const T2Diesel = T0Diesel * compRatio ** (GAMMA_AIR - 1);
  const P2Diesel = P0Diesel * compRatio ** GAMMA_AIR;
  const dUDiesel = n * Cv * (T2Diesel - T0Diesel);
  const WDiesel = -dUDiesel; // adiabatic, Q=0: W_on_gas = dU, W_by_gas = -dU
  const IGNITION_T = 483; // ~210°C, typical diesel autoignition

  const V1 = diesel ? V1Diesel : V1abs;
  const V2 = diesel ? V2Diesel : V2abs;
  const effT0 = diesel ? T0Diesel : T0;
  const T2 = diesel ? T2Diesel : T2abs;
  const dU = diesel ? dUDiesel : dUabs;
  const W = diesel ? WDiesel : Wabs;
  const effQ = diesel ? 0 : Q;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, V: V1, T: effT0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, V: V1, T: effT0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, V: V1, T: effT0 });
    setSeries([{ t: 0, V: V1, T: effT0 }]);
  }, [V1, effT0]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const paramKey = `${scenario}|${n}|${T0}|${P}|${Q}|${compRatio}`;
  const firstParams = useRef(paramKey);
  useEffect(() => {
    if (firstParams.current === paramKey) return;
    firstParams.current = paramKey;
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const ignitedNow = diesel && live.T >= IGNITION_T;
  const caption = diesel ? (
    ignitedNow ? (
      <>
        <b>Самовоспламенение!</b> Воздух сжат в {compRatio} раз так быстро, что тепло не успело уйти (Q = 0): вся работа поршня ушла во внутреннюю энергию, T = {(live.T - 273).toFixed(0)} °C. Впрыснутое
        топливо загорается само — свеча зажигания дизелю не нужна.
      </>
    ) : (
      <>
        <b>Такт сжатия:</b> коленвал толкает поршень вверх и быстро сжимает воздух. Тепло не успевает уйти, поэтому работа поршня целиком нагревает газ: T = {(live.T - 273).toFixed(0)} °C. Топливо
        вспыхнет само, когда станет горячее ~210 °C.
      </>
    )
  ) : Q >= 0 ? (
    <>
      <b>Горелка даёт газу тепло Q = {Q} Дж.</b> Часть идёт на нагрев (ΔU = {dU.toFixed(0)} Дж — молекулы быстрее), часть — на работу: газ расширяется и поднимает поршень с грузом (W ={" "}
      {W.toFixed(0)} Дж). Q = ΔU + W.
    </>
  ) : (
    <>
      <b>Газ охлаждают:</b> он отдаёт тепло ({Q} Дж), внутренняя энергия уменьшается (ΔU = {dU.toFixed(0)} Дж), а груз опускает поршень — работу совершают над газом (W = {W.toFixed(0)} Дж).
    </>
  );
  const legend: LegendItem[] = [
    { color: "#38bdf8", label: "холодный газ", kind: "square" },
    { color: "#f87171", label: "горячий газ", kind: "square" },
  ];

  const maxAbs = Math.max(Math.abs(dU), Math.abs(W), Math.abs(effQ), 1);
  const barPct = (v: number) => Math.min(100, (Math.abs(v) / maxAbs) * 100);

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={diesel ? { position: [3.6, 2.4, 6.4], fov: 50 } : { position: [4.2, 3.0, 6.4], fov: 50 }} orbitTarget={diesel ? [0, 1.0, 0] : [0.3, 1.3, 0]} simplified={isMobile} maxDistance={16} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent
            key={clock.resetNonce}
            V1={V1}
            V2={V2}
            T0={effT0}
            T2={T2}
            ignitionT={diesel ? IGNITION_T : undefined}
            running={clock.running}
            speed={clock.speed}
            onSample={handleSample}
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
        <div className="flex flex-col gap-3">
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "V(t)", value: (live.V * 1000).toFixed(2), unit: "л" },
              { label: "T(t)", value: live.T.toFixed(1), unit: "К", color: diesel && live.T >= IGNITION_T ? "#fbbf24" : undefined },
              { label: "Q", value: effQ.toFixed(0), unit: "Дж" },
              { label: "ΔU=nCvΔT", value: dU.toFixed(1), unit: "Дж" },
              { label: "W=PΔV (работа газа)", value: W.toFixed(1), unit: "Дж" },
              ...(diesel ? [{ label: "P₂ в конце такта сжатия", value: (P2Diesel / 1e6).toFixed(1), unit: "МПа" }] : []),
            ]}
          />
          <div className="rounded-xl border border-border bg-surface-2/60 p-4">
            <p className="mb-3 text-xs font-medium text-muted-2">Q = ΔU + W</p>
            <div className="flex h-28 items-end justify-center gap-6">
              {[
                { label: "Q", v: effQ, color: "#a1a1aa" },
                { label: "ΔU", v: dU, color: "#f87171" },
                { label: "W", v: W, color: "#4ade80" },
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
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">V(t) и T(t) — {diesel ? "адиабатное сжатие" : "изобарный процесс"}</p>
          <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "V", color: "#4ade80", label: "V, м³" }, { key: "T", color: "#f87171", label: "T, К" }]} />
        </div>
      }
      note={
        diesel ? (
          <>
            Дизель не имеет свечи зажигания: поршень быстро сжимает воздух (Q≈0 — процесс адиабатный, тепло не
            успевает уйти), и по формуле T₂=T₁(V₁/V₂)^(γ−1) при степени сжатия {compRatio}:1 температура
            подскакивает до {T2Diesel.toFixed(0)} К ({(T2Diesel - 273).toFixed(0)}°C) — выше температуры
            самовоспламенения дизельного топлива (≈210°C). Топливо впрыскивается в конце такта сжатия и
            воспламеняется само, без искры.
          </>
        ) : (
          <>
            Первое начало термодинамики: Q=ΔU+W. При изобарном процессе (P=const) работа газа W=PΔV, а
            изменение внутренней энергии ΔU=nC_vΔT (C_v=³⁄₂R для одноатомного газа). Проверка: Q=nC_pΔT=ΔU+W
            выполняется точно (C_p=C_v+R, уравнение Майера).
          </>
        )
      }
    />
  );
}
