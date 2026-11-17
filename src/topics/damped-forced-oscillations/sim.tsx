import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { SpringCoil } from "@/components/sim/SpringCoil";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { steadyStateAmplitude, undampedResonance } from "./physics";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { HangingWeight } from "@/components/sim/props/mechanics";
import { Car } from "@/components/sim/props/vehicles";
import { Ground, LabBench, RetortStand } from "@/components/sim/props/environment";

const TOP_Y = 3.1;
const L0 = 1.35;

interface SamplePoint {
  t: number;
  x: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  x: number;
  amplitudeEnvelope: number;
}

/** liquid look for a damping coefficient: none (air) → water → oil → honey */
function liquidFor(b: number) {
  if (b < 0.05) return null;
  if (b < 0.8) return { color: "#7dd3fc", opacity: 0.28, name: "вода" };
  if (b < 1.8) return { color: "#facc15", opacity: 0.4, name: "масло" };
  return { color: "#d97706", opacity: 0.6, name: "мёд" };
}

interface SceneContentProps {
  A0: number;
  beta: number;
  wd: number;
  forced: boolean;
  forcedAmplitude: number | null;
  force: number;
  mass: number;
  k: number;
  b: number;
  wDrive: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ A0, beta, wd, forced, forcedAmplitude, force, mass, k, b, wDrive, running, speed, onSample, onLive }: SceneContentProps) {
  const spring = useRef<THREE.Group>(null!);
  const springTop = useRef<THREE.Group>(null!);
  const weight = useRef<THREE.Group>(null!);
  const crank = useRef<THREE.Group>(null!);
  const liquid = liquidFor(b);
  // driving the top of the spring with amplitude d gives a force amplitude F₀ = k·d
  const driveAmp = forced ? Math.min(0.25, force / k) : 0;

  const xAt = useCallback(
    (t: number) => {
      if (forced) return forcedAmplitude === null ? undampedResonance(force, mass, wDrive, t).x : forcedAmplitude * Math.cos(wDrive * t);
      return A0 * Math.exp(-beta * t) * Math.cos(wd * t);
    },
    [forced, forcedAmplitude, force, mass, wDrive, A0, beta, wd],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const x = THREE.MathUtils.clamp(xAt(t), -0.9, 0.9);
      const top = TOP_Y + (forced ? driveAmp * Math.cos(wDrive * t) : 0);
      const weightY = TOP_Y - L0 - 0.4 - x;
      if (springTop.current) springTop.current.position.y = top;
      if (spring.current) spring.current.scale.x = Math.max(0.2, top - weightY);
      if (weight.current) weight.current.position.y = weightY;
      if (crank.current) crank.current.rotation.z = forced ? wDrive * t : 0;
    },
    [xAt, forced, driveAmp, wDrive],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={25}
        onSample={(t) => {
          const x = xAt(t);
          const envelope = forced ? forcedAmplitude ?? undampedResonance(force, mass, wDrive, t).envelope : A0 * Math.exp(-beta * t);
          onSample({ t, x });
          onLive({ t, x, amplitudeEnvelope: envelope });
        }}
      />
      <Ground kind="tiles" from={-5} to={5} width={6} tile={2} tileZ={2} y={-0.01} />
      <LabBench position={[0, 0, 0]} length={3} depth={1.4} height={0.75} />
      <RetortStand position={[-0.55, 0.75, -0.3]} height={TOP_Y - 0.75 + 0.35} armLength={0.7} />
      {/* motor with a crank that shakes the top of the spring (forced mode) */}
      {forced && (
        <group position={[0, TOP_Y + 0.42, -0.3]}>
          <mesh>
            <boxGeometry args={[0.36, 0.26, 0.26]} />
            <meshStandardMaterial color="#1d4ed8" metalness={0.5} roughness={0.4} />
          </mesh>
          <group ref={crank} position={[0, 0, 0.16]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.13, 0.13, 0.04, 24]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
            </mesh>
            <mesh position={[0.09, 0, 0.03]}>
              <sphereGeometry args={[0.025, 10, 8]} />
              <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.6} />
            </mesh>
          </group>
          <SceneLabel position={[0.55, 0.15, 0]}>мотор раскачивает пружину</SceneLabel>
        </group>
      )}
      <group ref={springTop} position={[0, TOP_Y, 0]}>
        <mesh>
          <boxGeometry args={[0.12, 0.06, 0.12]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
        </mesh>
        <group rotation={[0, 0, -Math.PI / 2]}>
          <SpringCoil ref={spring} color={forced ? "#fbbf24" : "#a78bfa"} loops={13} radius={0.09} />
        </group>
      </group>
      <group ref={weight} position={[0, TOP_Y - L0 - 0.4, 0]}>
        <HangingWeight height={0.32} radius={0.12} label={`${mass} кг`} />
      </group>
      {/* glass beaker; its liquid sets the damping */}
      <group position={[0, 0.75, 0]}>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 1.1, 32, 1, true]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.18} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.01, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.02, 32]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.35} />
        </mesh>
        {liquid && (
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.285, 0.285, 0.8, 32]} />
            <meshStandardMaterial color={liquid.color} transparent opacity={liquid.opacity} roughness={0.1} depthWrite={false} />
          </mesh>
        )}
        <SceneLabel position={[0.55, 0.9, 0]}>{liquid ? `стакан: ${liquid.name}` : "стакан пустой (воздух)"}</SceneLabel>
      </group>
    </>
  );
}

const BRIDGE_DESTROY_ANGLE = 0.55; // rad ≈ 31.5°
const SPAN = 9;
const SEGMENTS = 18;
const DECK_Y = 2.2;
const TOWER_X = SPAN / 2;

interface BridgeLive {
  t: number;
  angleDeg: number;
  destroyed: boolean;
}

function SceneBridge({
  F0,
  m,
  w0,
  beta,
  wDrive,
  running,
  speed,
  onLive,
  onFinished,
}: {
  F0: number;
  m: number;
  w0: number;
  beta: number;
  wDrive: number;
  running: boolean;
  speed: number;
  onLive: (n: BridgeLive) => void;
  onFinished: () => void;
}) {
  const segs = useRef<(THREE.Group | null)[]>([]);
  const car = useRef<THREE.Group>(null!);
  const finishedRef = useRef(false);
  const brokenAt = useRef<number | null>(null);
  const steadyAmp = steadyStateAmplitude(F0, m, w0, beta, wDrive) ?? 0;

  const angleAt = useCallback(
    (t: number) => {
      const envelope = steadyAmp * (1 - Math.exp(-beta * t));
      return envelope * Math.cos(wDrive * t) * 0.7;
    },
    [steadyAmp, beta, wDrive],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const angle = angleAt(t);
      if (brokenAt.current === null && Math.abs(angle) > BRIDGE_DESTROY_ANGLE) brokenAt.current = t;
      const fall = brokenAt.current === null ? 0 : t - brokenAt.current;
      segs.current.forEach((g, i) => {
        if (!g) return;
        const u = (i + 0.5) / SEGMENTS;
        // torsion is zero at the towers and largest mid-span (first twisting mode)
        g.rotation.x = angle * Math.sin(Math.PI * u);
        const mid = u > 0.3 && u < 0.7;
        g.position.y = DECK_Y - (mid ? 4.9 * fall * fall : 0);
      });
      if (car.current) {
        car.current.rotation.x = angle;
        car.current.position.y = DECK_Y + 0.09 - 4.9 * fall * fall;
      }
      if (!finishedRef.current && fall > 1.2) {
        finishedRef.current = true;
        onLive({ t, angleDeg: (angle * 180) / Math.PI, destroyed: true });
        onFinished();
      }
    },
    [angleAt, onFinished, onLive],
  );

  const cable = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = -TOWER_X + (i / 40) * SPAN;
      const u = x / TOWER_X;
      pts.push(new THREE.Vector3(x, DECK_Y + 0.35 + 2.1 * u * u, 0));
    }
    return pts;
  }, []);
  const cableGeos = useMemo(() => [-0.62, 0.62].map((z) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cable.map((p) => new THREE.Vector3(p.x, p.y, z))), 60, 0.035, 6, false)), [cable]);
  useEffect(() => () => cableGeos.forEach((g) => g.dispose()), [cableGeos]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const angle = angleAt(t);
          onLive({ t, angleDeg: (angle * 180) / Math.PI, destroyed: brokenAt.current !== null });
        }}
      />
      {/* water of the strait and the shores */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.15} metalness={0.3} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (TOWER_X + 2.5), DECK_Y / 2, 0]} castShadow>
            <boxGeometry args={[4.6, DECK_Y, 4]} />
            <meshStandardMaterial color="#57534e" roughness={0.95} />
          </mesh>
          {/* tower */}
          {[-0.62, 0.62].map((z) => (
            <mesh key={z} position={[s * TOWER_X, (DECK_Y + 2.6) / 2, z]} castShadow>
              <boxGeometry args={[0.22, DECK_Y + 2.6, 0.22]} />
              <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
          <mesh position={[s * TOWER_X, DECK_Y + 2.5, 0]}>
            <boxGeometry args={[0.24, 0.2, 1.5]} />
            <meshStandardMaterial color="#4b5563" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {cableGeos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial color="#9ca3af" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const x = -TOWER_X + ((i + 0.5) / SEGMENTS) * SPAN;
        const u = x / TOWER_X;
        const cableY = DECK_Y + 0.35 + 2.1 * u * u;
        return (
          <group
            key={i}
            ref={(g) => {
              segs.current[i] = g;
            }}
            position={[x, DECK_Y, 0]}
          >
            <mesh castShadow>
              <boxGeometry args={[SPAN / SEGMENTS + 0.01, 0.16, 1.2]} />
              <meshStandardMaterial color="#6b7280" roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.085, 0]}>
              <boxGeometry args={[SPAN / SEGMENTS * 0.45, 0.005, 0.05]} />
              <meshStandardMaterial color="#facc15" />
            </mesh>
            {[-0.62, 0.62].map((z) => (
              <mesh key={z} position={[0, (cableY - DECK_Y) / 2, z]}>
                <cylinderGeometry args={[0.008, 0.008, cableY - DECK_Y, 4]} />
                <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.3} />
              </mesh>
            ))}
          </group>
        );
      })}
      <group ref={car} position={[0.6, DECK_Y + 0.09, 0.25]}>
        <Car scale={0.16} color="#a16207" />
      </group>
      <SceneLabel position={[0, DECK_Y + 2.9, 0]}>мост Такома-Нэрроуз (пролёт закручивается ветром)</SceneLabel>
      <SceneLabel position={[-TOWER_X - 2.5, DECK_Y + 0.6, 1.8]}>ветер ≈ 19 м/с поперёк моста</SceneLabel>
    </>
  );
}

export function DampedForcedOscillationsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, m, k, b, forced, F0, wDrive, wDriveBridge } = useControls("Затухающие/вынужденные", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Груз на пружине в жидкости": "abstract", "Мост Такома-Нэрроуз": "bridge" },
    },
    m: { value: 1, min: 0.3, max: 3, step: 0.1, label: "m, кг", render: (get) => get("Затухающие/вынужденные.scenario") === "abstract" },
    k: { value: 40, min: 10, max: 100, step: 1, label: "k, Н/м", render: (get) => get("Затухающие/вынужденные.scenario") === "abstract" },
    b: {
      value: 1,
      min: 0,
      max: 3,
      step: 0.05,
      label: "b, кг/с (затухание: вязкость жидкости)",
      render: (get) => get("Затухающие/вынужденные.scenario") === "abstract",
    },
    forced: { value: false, label: "вынужденные (резонанс)", render: (get) => get("Затухающие/вынужденные.scenario") === "abstract" },
    F0: {
      value: 5,
      min: 1,
      max: 15,
      step: 0.5,
      label: "F₀, Н",
      render: (get) => get("Затухающие/вынужденные.scenario") === "abstract" && get("Затухающие/вынужденные.forced"),
    },
    wDrive: {
      value: 6,
      min: 0.5,
      max: 12,
      step: 0.1,
      label: "ω вын., рад/с",
      render: (get) => get("Затухающие/вынужденные.scenario") === "abstract" && get("Затухающие/вынужденные.forced"),
    },
    wDriveBridge: {
      value: 1,
      min: 0.7,
      max: 1.3,
      step: 0.01,
      label: "ω ветра / ω₀ моста",
      render: (get) => get("Затухающие/вынужденные.scenario") === "bridge",
    },
  });

  const bridge = scenario === "bridge";
  const mBridge = 1;
  const kBridge = 40;
  const w0Bridge = Math.sqrt(kBridge / mBridge);
  const betaBridge = 0.06;
  const F0Bridge = 5;
  const [bridgeLive, setBridgeLive] = useState<BridgeLive>({ t: 0, angleDeg: 0, destroyed: false });

  const w0 = Math.sqrt(k / m);
  const beta = Math.min(b / (2 * m), w0 * 0.98);
  const wd = Math.sqrt(Math.max(w0 * w0 - beta * beta, 0.0001));
  const A0 = 0.35;
  const forcedAmplitude = steadyStateAmplitude(F0, m, w0, beta, wDrive);
  const resonant = forced && forcedAmplitude === null;

  const resonanceCurve = useMemo(() => {
    const pts: { omega: number; amp: number | undefined }[] = [];
    const maxW = w0 * 2.2;
    for (let i = 0; i <= 60; i++) {
      const w = (i / 60) * maxW;
      pts.push({ omega: w, amp: steadyStateAmplitude(F0, m, w0, beta, w) ?? undefined });
    }
    if (beta === 0) pts.push({ omega: w0, amp: undefined });
    pts.sort((a, b) => a.omega - b.omega);
    return pts;
  }, [F0, m, w0, beta]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, x: forced ? forcedAmplitude ?? 0 : A0, amplitudeEnvelope: forced ? forcedAmplitude ?? 0 : A0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, x: forced ? forcedAmplitude ?? 0 : A0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => ((prev[prev.length - 1]?.t ?? -1) >= p.t ? [p] : prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    const x0 = forced ? forcedAmplitude ?? 0 : A0;
    setLive({ t: 0, x: x0, amplitudeEnvelope: x0 });
    setSeries([{ t: 0, x: x0 }]);
  }, [forced, forcedAmplitude]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const handleFinished = useCallback(() => clock.pause(), [clock]);

  // any parameter change restarts the experiment from its initial state
  const paramKey = `${scenario}|${m}|${k}|${b}|${forced}|${F0}|${wDrive}|${wDriveBridge}`;
  const firstParams = useRef(paramKey);
  useEffect(() => {
    if (firstParams.current === paramKey) return;
    firstParams.current = paramKey;
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const liquid = liquidFor(b);
  let caption;
  let legend: LegendItem[];
  if (bridge) {
    const ratio = wDriveBridge;
    caption = bridgeLive.destroyed ? (
      <><b>Пролёт рухнул.</b> Порывы ветра попадали в такт собственным крутильным колебаниям моста, и каждое качание добавляло энергии больше, чем успевало рассеяться.</>
    ) : Math.abs(ratio - 1) < 0.04 ? (
      <><b>Резонанс:</b> ветер раскачивает мост точно в такт (ω_ветра ≈ ω₀). Затухание у подвесного моста маленькое — закручивание растёт с каждым периодом: сейчас {Math.abs(bridgeLive.angleDeg).toFixed(0)}°.</>
    ) : (
      <><b>Не в такт:</b> ω_ветра/ω₀ = {ratio.toFixed(2).replace(".", ",")}. Толчки ветра то помогают, то мешают, и закручивание остаётся небольшим — {Math.abs(bridgeLive.angleDeg).toFixed(0)}°. Сдвиньте ползунок к 1,00.</>
    );
    legend = [];
  } else if (forced) {
    caption = resonant ? (
      <><b>Точный резонанс без затухания:</b> мотор качает с собственной частотой ω₀ = {w0.toFixed(2).replace(".", ",")} рад/с, и размах растёт с каждым периодом — конечной амплитуды нет.</>
    ) : (
      <>
        <b>Вынужденные колебания:</b> мотор качает верх пружины с частотой {wDrive.toFixed(1).replace(".", ",")} рад/с (собственная ω₀ = {w0.toFixed(1).replace(".", ",")}). Установившийся размах{" "}
        {(forcedAmplitude ?? 0).toFixed(3).replace(".", ",")} м — он наибольший, когда частоты совпадают (резонанс).
      </>
    );
    legend = [{ color: "#fbbf24", label: "x(t) груза", kind: "line" }];
  } else {
    caption = liquid ? (
      <>
        <b>Затухающие колебания:</b> груз качается в стакане ({liquid.name}). Жидкость тормозит его (b = {b.toFixed(2).replace(".", ",")} кг/с), и размах уменьшается в e раз за 1/β ={" "}
        {(1 / Math.max(beta, 1e-6)).toFixed(1).replace(".", ",")} с. Чем гуще жидкость, тем быстрее гаснут колебания.
      </>
    ) : (
      <><b>Без затухания:</b> стакан пустой, трения нет — груз качается с одинаковым размахом бесконечно. Добавьте b — нальём в стакан жидкость.</>
    );
    legend = [{ color: "#a78bfa", label: "x(t) груза", kind: "line" }];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={bridge ? { position: [3, 5.5, 13], fov: 50 } : { position: [1.6, 2.4, 5], fov: 50 }}
          orbitTarget={bridge ? [0, 2.4, 0] : [0, 1.7, 0]}
          simplified={isMobile}
          maxDistance={30}
          minDistance={2}
          bloomThreshold={0.6}
          fogRange={[18, 50]}
        >
          {bridge ? (
            <SceneBridge
              key={clock.resetNonce}
              F0={F0Bridge}
              m={mBridge}
              w0={w0Bridge}
              beta={betaBridge}
              wDrive={wDriveBridge * w0Bridge}
              running={clock.running}
              speed={clock.speed}
              onLive={setBridgeLive}
              onFinished={handleFinished}
            />
          ) : (
            <SceneContent key={`${clock.resetNonce}:${resonant}`} A0={A0} beta={beta} wd={wd} forced={forced} forcedAmplitude={forcedAmplitude} force={F0} mass={m} k={k} b={b} wDrive={wDrive} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        bridge ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: bridgeLive.t.toFixed(2), unit: "с" },
              { label: "Угол закручивания", value: bridgeLive.angleDeg.toFixed(1), unit: "°", color: Math.abs(bridgeLive.angleDeg) > 25 ? "#f87171" : "#4ade80" },
              { label: "ω ветра / ω₀", value: wDriveBridge.toFixed(2), unit: "" },
              { label: "Статус", value: bridgeLive.destroyed ? "разрушение!" : "колеблется", color: bridgeLive.destroyed ? "#f87171" : "#4ade80" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "x(t)", value: live.x.toFixed(3), unit: "м" },
              { label: "ω₀=√(k/m)", value: w0.toFixed(2), unit: "рад/с" },
              { label: "β=b/2m", value: beta.toFixed(2), unit: "1/с" },
              { label: forced ? "ω резонанса" : "ω_д=√(ω₀²−β²)", value: forced ? Math.sqrt(Math.max(w0 * w0 - 2 * beta * beta, 0)).toFixed(2) : wd.toFixed(2), unit: "рад/с" },
              { label: "Амплитуда", value: live.amplitudeEnvelope.toFixed(3), unit: "м" },
            ]}
          />
        )
      }
      graphs={
        bridge ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            При ω_ветра≈ω₀ моста и малом затухании (реальный подвесной мост почти не гасит крутильные колебания)
            амплитуда растёт от колебания к колебанию, пока не превысит запас прочности конструкции — именно так
            обрушился мост Такома-Нэрроуз в 1940 году.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">x(t)</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "x", color: forced ? "#fbbf24" : "#a78bfa", label: "x, м" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Резонансная кривая A(ω) при текущих m,k,b</p>
              <LiveChart data={resonanceCurve} xKey="omega" xLabel="ω, рад/с" series={[{ key: "amp", color: "#f87171", label: "A, м" }]} />
              {beta === 0 && <p className="mt-2 text-xs text-muted">При ω=ω₀ и β=0 конечной установившейся амплитуды нет.</p>}
            </div>
          </div>
        )
      }
      note={
        bridge ? (
          <>
            Такома-Нэрроуз (1940) — хрестоматийный пример резонанса: ветер раскачивал мост на частоте, близкой к
            собственной, а слабое демпфирование не успевало рассеивать энергию — амплитуда росла, пока мост не
            разрушился. Та же математика, что и качели: толчки в такт с собственной частотой складываются.
          </>
        ) : resonant ? (
          <>При точном резонансе без затухания амплитуда растёт со временем: x(t)=F₀t·sin(ω₀t)/(2mω₀). Здесь груз начинает движение из покоя; постоянной установившейся амплитуды нет.</>
        ) : forced ? (
          <>
            Установившаяся амплитуда A(ω)=(F₀/m)/√((ω₀²−ω²)²+4β²ω²). Резонанс при ω≈√(ω₀²−2β²)≈
            {Math.sqrt(Math.max(w0 * w0 - 2 * beta * beta, 0)).toFixed(2)} рад/с — это тот же эффект, что и на
            качелях: если толкать в такт с собственной частотой, амплитуда растёт сильнее всего.
          </>
        ) : (
          <>Свободные затухающие колебания x(t)=A₀e^(−βt)cos(ω_дt). Огибающая A₀e^(−βt) — пунктирное затухание амплитуды.</>
        )
      }
    />
  );
}
