import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { TimeMarks, type TimeMarksHandle } from "@/components/sim/TimeMarks";
import { CameraFollow } from "@/components/sim/CameraFollow";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Car, LabCart } from "@/components/sim/props/vehicles";
import { Person } from "@/components/sim/props/Person";
import { runPose, STAND, type PoseAngles } from "@/components/sim/props/pose";
import { DistancePost, Ground, Tree } from "@/components/sim/props/environment";
import { canvasTexture, tapeTexture, textTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/* ------------------------------------------------------------------ */
/* motion models (exact formulas, evaluated at any time t)             */
/* ------------------------------------------------------------------ */

type Phase = "move" | "edge" | "reaction" | "brake" | "stopped" | "accel" | "cruise" | "slowdown" | "done";

interface MotionState {
  /** displacement from the start, m (cart: coordinate x) */
  s: number;
  v: number;
  a: number;
  phase: Phase;
}

const HALF_TRACK = 10;
const CART_EDGE = 9.4;
const CART_MAX_T = 40;
const CROSSING = 50;
const CAR_ACCEL_DIST = 150;
const RACE = 100;
const SPRINT_DECEL = 4;

const SURFACES = {
  dry: { label: "сухой асфальт", dec: 6.9 },
  wet: { label: "мокрый асфальт", dec: 3.9 },
  snow: { label: "укатанный снег", dec: 2.0 },
  ice: { label: "гололёд", dec: 1.0 },
} as const;
type Surface = keyof typeof SURFACES;

function cartAt(x0: number, v0: number, a: number, t: number): MotionState {
  const x = x0 + v0 * t + 0.5 * a * t * t;
  return { s: x, v: v0 + a * t, a, phase: Math.abs(x) > CART_EDGE || t > CART_MAX_T ? "edge" : "move" };
}

function carAccelAt(a: number, t: number): MotionState {
  const s = 0.5 * a * t * t;
  return { s, v: a * t, a, phase: s >= CAR_ACCEL_DIST ? "done" : "accel" };
}

function carBrakeAt(v0: number, reaction: number, dec: number, t: number): MotionState {
  if (t < reaction) return { s: v0 * t, v: v0, a: 0, phase: "reaction" };
  const tb = t - reaction;
  const tStop = v0 / dec;
  if (tb < tStop) return { s: v0 * reaction + v0 * tb - 0.5 * dec * tb * tb, v: v0 - dec * tb, a: -dec, phase: "brake" };
  return { s: v0 * reaction + (v0 * v0) / (2 * dec), v: 0, a: 0, phase: "stopped" };
}

function sprintTimes(a: number, vmax: number) {
  const t1 = vmax / a;
  const s1 = 0.5 * a * t1 * t1;
  if (s1 >= RACE) {
    const tf = Math.sqrt((2 * RACE) / a);
    return { t1: tf, s1: RACE, tf, vf: a * tf };
  }
  return { t1, s1, tf: t1 + (RACE - s1) / vmax, vf: vmax };
}

function sprintAt(a: number, vmax: number, t: number): MotionState {
  const { t1, s1, tf, vf } = sprintTimes(a, vmax);
  if (t < t1) return { s: 0.5 * a * t * t, v: a * t, a, phase: "accel" };
  if (t < tf) return { s: s1 + vmax * (t - t1), v: vmax, a: 0, phase: "cruise" };
  const td = t - tf;
  const tStop = vf / SPRINT_DECEL;
  if (td < tStop) return { s: RACE + vf * td - 0.5 * SPRINT_DECEL * td * td, v: vf - SPRINT_DECEL * td, a: -SPRINT_DECEL, phase: "slowdown" };
  return { s: RACE + (vf * vf) / (2 * SPRINT_DECEL), v: 0, a: 0, phase: "done" };
}

type Scenario = "abstract" | "car" | "sprinter";

interface Params {
  scenario: Scenario;
  // cart
  x0: number;
  v0: number;
  a: number;
  // car
  maneuver: "brake" | "accel";
  aCar: number;
  vCar: number;
  dec: number;
  reaction: number;
  // sprinter
  aSprint: number;
  vMax: number;
}

function motionAt(p: Params, t: number): MotionState {
  if (p.scenario === "car") return p.maneuver === "accel" ? carAccelAt(p.aCar, t) : carBrakeAt(p.vCar, p.reaction, p.dec, t);
  if (p.scenario === "sprinter") return sprintAt(p.aSprint, p.vMax, t);
  return cartAt(p.x0, p.v0, p.a, t);
}

/** the run is over: freeze the clock shortly after this time */
function isFinished(m: MotionState) {
  return m.phase === "edge" || m.phase === "stopped" || m.phase === "done";
}

interface Sample {
  t: number;
  x: number;
  v: number;
  [key: string]: number;
}

interface Live {
  t: number;
  m: MotionState;
}

/* ------------------------------------------------------------------ */
/* scenery                                                             */
/* ------------------------------------------------------------------ */

function LabTrack() {
  const tape = useMemo(() => tapeTexture(-HALF_TRACK, HALF_TRACK, 1), []);
  return (
    <group>
      <Ground kind="tiles" from={-16} to={16} width={12} tile={3} tileZ={3} y={-0.002} />
      {/* aluminium rail the cart rides on */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[HALF_TRACK * 2 + 1, 0.02, 0.75]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* measuring tape along the track */}
      <mesh position={[0, 0.012, 0.75]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[HALF_TRACK * 2, 0.42]} />
        <meshStandardMaterial map={tape} roughness={0.7} />
      </mesh>
      <SceneLabel position={[HALF_TRACK - 0.4, 0.35, 1.25]}>мерная лента, x в метрах</SceneLabel>
    </group>
  );
}

function crossingSignTexture() {
  return canvasTexture("crossing-sign", 128, 128, (ctx, w, h) => {
    ctx.fillStyle = "#1d4ed8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(w / 2, 14);
    ctx.lineTo(w - 12, h - 16);
    ctx.lineTo(12, h - 16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(w / 2 + 4, 44, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#111";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w / 2 + 2, 54);
    ctx.lineTo(w / 2 - 2, 80);
    ctx.moveTo(w / 2 - 2, 80);
    ctx.lineTo(w / 2 - 14, 98);
    ctx.moveTo(w / 2 - 2, 80);
    ctx.lineTo(w / 2 + 12, 98);
    ctx.moveTo(w / 2 + 1, 62);
    ctx.lineTo(w / 2 - 14, 72);
    ctx.moveTo(w / 2 + 1, 62);
    ctx.lineTo(w / 2 + 16, 70);
    ctx.stroke();
  });
}

function Roadside({ length, crossing, simplified }: { length: number; crossing: boolean; simplified: boolean }) {
  const trees = useMemo(() => {
    const list: { x: number; z: number; h: number; conifer: boolean; seed: number }[] = [];
    const step = simplified ? 26 : 15;
    for (let i = 0, x = -24; x < length + 30; i++, x += step + ((i * 7) % 6)) {
      list.push({ x, z: -9 - ((i * 13) % 5), h: 5 + ((i * 3) % 4), conifer: i % 3 === 0, seed: i });
      if (i % 2 === 0) list.push({ x: x + 7, z: -15 - ((i * 11) % 4), h: 4.5 + ((i * 5) % 3), conifer: i % 4 === 1, seed: i + 50 });
    }
    return list;
  }, [length, simplified]);
  const posts = useMemo(() => {
    const list: number[] = [];
    for (let d = 0; d <= length; d += d < 120 ? 10 : 50) list.push(d);
    return list;
  }, [length]);
  const sign = useMemo(() => crossingSignTexture(), []);
  return (
    <group>
      <Ground kind="grass" from={-40} to={length + 60} width={60} tile={8} tileZ={8} y={-0.01} />
      <Ground kind="road" from={-40} to={length + 60} width={7} tile={8} y={0.002} />
      {trees.map((tr) => (
        <Tree key={`${tr.seed}-${tr.x}`} position={[tr.x, 0, tr.z]} height={tr.h} conifer={tr.conifer} seed={tr.seed} />
      ))}
      {posts.map((d) => (
        <DistancePost key={d} text={`${d} м`} position={[d, 0, -4.2]} />
      ))}
      {crossing && (
        <group position={[CROSSING, 0, 0]}>
          {/* stop line + zebra */}
          <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.4, 6.6]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.8} />
          </mesh>
          {Array.from({ length: 6 }, (_, i) => (
            <mesh key={i} position={[2.6, 0.006, -2.75 + i * 1.1]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[3.2, 0.55]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.8} />
            </mesh>
          ))}
          <mesh position={[0.6, 1.3, -4]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 2.6, 8]} />
            <meshStandardMaterial color="#9ca3af" metalness={0.7} roughness={0.4} />
          </mesh>
          <mesh position={[0.6, 2.55, -3.95]}>
            <planeGeometry args={[0.7, 0.7]} />
            <meshStandardMaterial map={sign} roughness={0.6} />
          </mesh>
          <Person position={[2.6, 0, -4.6]} rotation={[0, 0, 0]} shirt="#e11d48" pants="#334155" />
          <SceneLabel position={[2.6, 2.3, -4.6]}>пешеход ждёт у перехода</SceneLabel>
          <SceneLabel position={[0, 0.5, 3.6]}>стоп-линия: 50 м от машины</SceneLabel>
        </group>
      )}
    </group>
  );
}

function RunningTrack() {
  const finish = useMemo(
    () =>
      canvasTexture("finish-line", 64, 256, (ctx, w, h) => {
        const n = 4;
        const cell = w / n;
        for (let y = 0; y < h / cell; y++)
          for (let x = 0; x < n; x++) {
            ctx.fillStyle = (x + y) % 2 ? "#111" : "#f8fafc";
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
      }),
    [],
  );
  const banner = useMemo(() => textTexture("ФИНИШ", { color: "#ffffff", background: "#dc2626", font: "bold 64px sans-serif", width: 384, height: 96 }), []);
  const posts: number[] = [];
  for (let d = 10; d <= RACE; d += 10) posts.push(d);
  return (
    <group>
      <Ground kind="grass" from={-40} to={RACE + 70} width={40} tile={8} tileZ={8} y={-0.01} />
      <Ground kind="track" from={-25} to={RACE + 50} width={5} tile={5} y={0.002} />
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.1, 5]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[RACE, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.6, 5]} />
        <meshStandardMaterial map={finish} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[RACE, 1.6, s * 2.9]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 3.2, 10]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[RACE, 3.0, 0]}>
        <boxGeometry args={[0.06, 0.6, 5.8]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
      <mesh position={[RACE + 0.035, 3.0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.4, 0.6]} />
        <meshStandardMaterial map={banner} />
      </mesh>
      {/* starting blocks */}
      {[0.12, -0.12].map((dz, i) => (
        <mesh key={dz} position={[-0.45 - i * 0.3, 0.07, 0.6 + dz]} rotation={[0, 0, 0.6]} castShadow>
          <boxGeometry args={[0.18, 0.08, 0.12]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {posts.map((d) => (
        <DistancePost key={d} text={`${d} м`} position={[d, 0, -3.2]} height={0.9} />
      ))}
      <SceneLabel position={[0, 0.4, 2.9]}>старт</SceneLabel>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* scene                                                               */
/* ------------------------------------------------------------------ */

interface SceneProps {
  params: Params;
  running: boolean;
  speed: number;
  simplified: boolean;
  onSample: (s: Sample) => void;
  onFinished: () => void;
}

const CAR_HALF = 2.27;
/** the camera looks this far ahead of the car so the crossing comes into view while braking */
const CAR_LEAD = 7;

function KinematicsScene({ params, running, speed, simplified, onSample, onFinished }: SceneProps) {
  const { scenario } = params;
  const body = useRef<THREE.Group>(null!);
  const spin = useRef(0);
  const brake = useRef(0);
  const poseRef = useRef<PoseAngles>(STAND);
  const vArrow = useRef<VectorArrowHandle>(null);
  const aArrow = useRef<VectorArrowHandle>(null);
  const marks = useRef<TimeMarksHandle>(null);
  const nextMark = useRef(0);
  const finished = useRef(false);
  const finishAt = useRef<number | null>(null);

  const markEvery = scenario === "sprinter" ? 1 : 0.5;
  const vScale = scenario === "car" ? 0.13 : scenario === "sprinter" ? 0.17 : 0.4;
  const aScale = scenario === "car" ? 0.45 : scenario === "sprinter" ? 0.4 : 0.6;
  const arrowY = scenario === "car" ? 2.2 : scenario === "sprinter" ? 2.3 : 1.35;

  /** world x of the body: the car's distance is measured at its front bumper, the body origin is its centre */
  const worldX = useCallback((m: MotionState) => (scenario === "car" ? m.s - CAR_HALF : m.s), [scenario]);

  const handleFrame = useCallback(
    (t: number) => {
      const m = motionAt(params, t);
      const x = worldX(m);
      if (body.current) body.current.position.x = scenario === "abstract" ? THREE.MathUtils.clamp(x, -HALF_TRACK - 1, HALF_TRACK + 1) : x;
      if (scenario === "car") {
        spin.current = m.s / 0.34;
        brake.current = m.phase === "brake" || m.phase === "stopped" ? 1 : 0;
      } else if (scenario === "abstract") {
        spin.current = (m.s - params.x0) / 0.11;
      } else {
        poseRef.current = m.v < 0.05 && m.phase !== "slowdown" ? STAND : runPose((m.s / 4.2) * Math.PI * 2, Math.min(1, m.v / 3));
      }
      vArrow.current?.set([x, arrowY, 0], [m.v * vScale, 0, 0]);
      aArrow.current?.set([x, arrowY + 0.6, 0], [m.a * aScale, 0, 0]);

      while (t >= nextMark.current && !finished.current) {
        const mm = motionAt(params, nextMark.current);
        if (mm.phase !== "stopped" && mm.phase !== "done" && mm.phase !== "edge") {
          marks.current?.add(worldX(mm), 0.03, scenario === "car" ? 1.6 : scenario === "sprinter" ? 1.1 : 0.42);
        }
        nextMark.current += markEvery;
      }

      if (!finished.current && isFinished(m)) {
        if (finishAt.current === null) finishAt.current = t;
        if (t - finishAt.current > (scenario === "abstract" ? 0 : 1)) {
          finished.current = true;
          onSample({ t, x: m.s, v: m.v });
          onFinished();
        }
      }
    },
    [params, scenario, worldX, arrowY, vScale, aScale, markEvery, onFinished, onSample],
  );

  const roadLength = useMemo(() => {
    if (scenario !== "car") return 0;
    if (params.maneuver === "accel") return CAR_ACCEL_DIST + 20;
    const stop = params.vCar * params.reaction + (params.vCar * params.vCar) / (2 * params.dec);
    return Math.max(CROSSING + 30, stop + 30);
  }, [scenario, params]);

  const start = motionAt(params, 0);
  const startX = worldX(start);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => {
          const m = motionAt(params, t);
          onSample({ t, x: m.s, v: m.v });
        }}
      />
      {scenario === "car" && <Roadside length={roadLength} crossing={params.maneuver === "brake"} simplified={simplified} />}
      {scenario === "sprinter" && <RunningTrack />}
      {scenario === "abstract" && <LabTrack />}

      {scenario === "car" && (
        <>
          <Car ref={body} position={[startX, 0, 0]} color="#d43c33" spinRef={spin} brakeRef={brake} />
          <CameraFollow target={body} lead={CAR_LEAD} />
        </>
      )}
      {scenario === "sprinter" && (
        <>
          <group ref={body} position={[startX, 0, 0.6]}>
            <Person rotation={[0, Math.PI / 2, 0]} poseRef={poseRef} shirt="#f59e0b" pants="#111827" skin="#c68a5e" hair="#111" />
          </group>
          <CameraFollow target={body} lead={2} />
        </>
      )}
      {scenario === "abstract" && (
        <>
          <group ref={body} position={[startX, 0.02, 0]}>
            <LabCart length={1} color="#7c6cf5" tag="1" spinRef={spin} />
            <SceneLabel position={[0, 1.05, 0]}>тележка</SceneLabel>
          </group>
          <CameraFollow target={body} min={-5} max={5} />
        </>
      )}
      <TimeMarks ref={marks} color="#c084fc" radius={scenario === "abstract" ? 0.09 : 0.16} />
      <VectorArrow ref={vArrow} color="#4ade80" />
      <VectorArrow ref={aArrow} color="#f87171" />
    </>
  );
}

function stageFor(params: Params) {
  if (params.scenario === "car") {
    const x = -CAR_HALF + CAR_LEAD;
    return { camera: { position: [x - 4, 7, 20] as [number, number, number], fov: 50 }, target: [x, 1, 0] as [number, number, number], min: 5, max: 60, fog: [30, 90] as [number, number] };
  }
  if (params.scenario === "sprinter") {
    return { camera: { position: [0, 2.8, 9] as [number, number, number], fov: 50 }, target: [2, 1, 0] as [number, number, number], min: 3, max: 30, fog: [16, 60] as [number, number] };
  }
  const x = THREE.MathUtils.clamp(params.x0, -5, 5);
  return { camera: { position: [x, 3.6, 11] as [number, number, number], fov: 50 }, target: [x, 0.6, 0] as [number, number, number], min: 3, max: 30, fog: [16, 45] as [number, number] };
}

/* ------------------------------------------------------------------ */
/* captions                                                            */
/* ------------------------------------------------------------------ */

const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const f0 = (n: number) => n.toFixed(0);

function captionFor(params: Params, live: Live, surface: Surface) {
  const { m, t } = live;
  if (params.scenario === "car") {
    if (params.maneuver === "accel") {
      if (m.phase === "done") return <>Через {f1(t)} с машина проехала {CAR_ACCEL_DIST} м и разогналась до {f0(m.v * 3.6)} км/ч. Путь растёт как t², поэтому отметки разбегаются всё шире.</>;
      return (
        <>
          <b>Разгон с места.</b> Каждую секунду скорость растёт на {f1(params.aCar)} м/с (≈ {f0(params.aCar * 3.6)} км/ч). Сейчас {f0(m.v * 3.6)} км/ч.
        </>
      );
    }
    const sr = params.vCar * params.reaction;
    const sb = (params.vCar * params.vCar) / (2 * params.dec);
    const total = sr + sb;
    if (m.phase === "reaction")
      return (
        <>
          <b>Водитель заметил пешехода в {CROSSING} м впереди.</b> Пока нога переходит на тормоз ({f1(params.reaction)} с), машина едет равномерно со скоростью {f0(params.vCar * 3.6)} км/ч.
        </>
      );
    if (m.phase === "brake")
      return (
        <>
          <b>Тормоза!</b> На покрытии «{SURFACES[surface].label}» скорость падает на {f1(params.dec)} м/с каждую секунду — отметки сближаются. Сейчас {f0(m.v * 3.6)} км/ч.
        </>
      );
    return total <= CROSSING ? (
      <>
        <b>Успела!</b> Машина остановилась за {f1(CROSSING - total)} м до перехода. Остановочный путь {f1(total)} м = {f1(sr)} м за время реакции + {f1(sb)} м торможения.
      </>
    ) : (
      <>
        <b>Не успела:</b> машина проехала стоп-линию на {f1(total - CROSSING)} м. Остановочный путь {f1(total)} м = {f1(sr)} м (реакция) + {f1(sb)} м (торможение). Снизьте скорость.
      </>
    );
  }
  if (params.scenario === "sprinter") {
    const { tf } = sprintTimes(params.aSprint, params.vMax);
    if (t < 0.05) return <>На старт! Спринтер в колодках, скорость равна нулю.</>;
    if (m.phase === "accel") return <><b>Разгон.</b> Скорость растёт на {f1(params.aSprint)} м/с каждую секунду — шаги и расстояния между отметками (каждую секунду) становятся всё длиннее.</>;
    if (m.phase === "cruise") return <><b>Максимальная скорость {f1(params.vMax)} м/с</b> (≈ {f0(params.vMax * 3.6)} км/ч) набрана — дальше бег почти равномерный: за каждую секунду ~{f1(params.vMax)} м.</>;
    return <><b>Финиш! 100 м за {tf.toFixed(2).replace(".", ",")} с.</b> После линии спринтер тормозит и останавливается.</>;
  }
  if (m.phase === "edge") return <>Тележка доехала до края ленты. Нажмите ↺, чтобы повторить, или поменяйте числа.</>;
  if (params.a === 0) return <><b>Равномерное движение:</b> скорость {f1(Math.abs(m.v))} м/с не меняется, за каждые 0,5 с тележка проходит одинаковый путь — отметки стоят на равных расстояниях.</>;
  if (Math.abs(m.v) < 0.15) return <><b>Мгновенная остановка:</b> v = 0, но ускорение не исчезло — сейчас тележка поедет в другую сторону.</>;
  if (m.v * params.a > 0) return <><b>Скорость и ускорение направлены в одну сторону — тележка разгоняется:</b> отметки (каждые 0,5 с) расходятся всё шире.</>;
  return <><b>Ускорение направлено против скорости — тележка тормозит:</b> расстояния между отметками сокращаются.</>;
}

/* ------------------------------------------------------------------ */

export function KinematicsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const c = useControls("Кинематика", {
    scenario: {
      value: "car",
      label: "Жизненный пример",
      options: { "Автомобиль на дороге": "car", "Спринтер: забег на 100 м": "sprinter", "Тележка (свои числа)": "abstract" },
    },
    maneuver: {
      value: "brake",
      label: "Манёвр",
      options: { "Экстренное торможение перед переходом": "brake", "Разгон с места": "accel" },
      render: (get) => get("Кинематика.scenario") === "car",
    },
    speedKmh: { value: 60, min: 20, max: 120, step: 5, label: "скорость, км/ч", render: (get) => get("Кинематика.scenario") === "car" && get("Кинематика.maneuver") === "brake" },
    surface: {
      value: "dry",
      label: "покрытие",
      options: { "Сухой асфальт": "dry", "Мокрый асфальт": "wet", "Укатанный снег": "snow", "Гололёд": "ice" },
      render: (get) => get("Кинематика.scenario") === "car" && get("Кинематика.maneuver") === "brake",
    },
    reaction: { value: 1, min: 0.3, max: 2, step: 0.1, label: "реакция водителя, с", render: (get) => get("Кинематика.scenario") === "car" && get("Кинематика.maneuver") === "brake" },
    aCar: { value: 3, min: 1, max: 6, step: 0.5, label: "ускорение разгона a, м/с²", render: (get) => get("Кинематика.scenario") === "car" && get("Кинематика.maneuver") === "accel" },
    aSprint: { value: 3, min: 1.5, max: 4, step: 0.1, label: "ускорение на старте, м/с²", render: (get) => get("Кинематика.scenario") === "sprinter" },
    vMax: { value: 11, min: 6, max: 12.5, step: 0.1, label: "макс. скорость, м/с", render: (get) => get("Кинематика.scenario") === "sprinter" },
    mode: {
      value: "accel",
      options: { "Равноускоренное": "accel", "Равномерное": "uniform" },
      label: "Режим",
      render: (get) => get("Кинематика.scenario") === "abstract",
    },
    x0: { value: -7, min: -9, max: 9, step: 1, label: "x₀, м", render: (get) => get("Кинематика.scenario") === "abstract" },
    v0: { value: 1, min: -8, max: 8, step: 0.5, label: "v₀, м/с", render: (get) => get("Кинематика.scenario") === "abstract" },
    a: {
      value: 0.8,
      min: -4,
      max: 4,
      step: 0.1,
      label: "a, м/с²",
      render: (get) => get("Кинематика.scenario") === "abstract" && get("Кинематика.mode") === "accel",
    },
  });

  const scenario = c.scenario as Scenario;
  const surface = c.surface as Surface;
  const params: Params = useMemo(
    () => ({
      scenario,
      x0: c.x0,
      v0: c.v0,
      a: c.mode === "uniform" ? 0 : c.a,
      maneuver: c.maneuver as "brake" | "accel",
      aCar: c.aCar,
      vCar: c.speedKmh / 3.6,
      dec: SURFACES[surface].dec,
      reaction: c.reaction,
      aSprint: c.aSprint,
      vMax: c.vMax,
    }),
    [scenario, surface, c.x0, c.v0, c.a, c.mode, c.maneuver, c.aCar, c.speedKmh, c.reaction, c.aSprint, c.vMax],
  );
  const runKey = `${clock.resetNonce}|${JSON.stringify(params)}`;

  const initial = useMemo<Live>(() => ({ t: 0, m: motionAt(params, 0) }), [params]);
  const [live, setLive] = useState<Live>(initial);
  const [series, setSeries] = useState<Sample[]>([{ t: 0, x: initial.m.s, v: initial.m.v }]);

  const play = clock.play;
  useEffect(() => {
    setLive(initial);
    setSeries([{ t: 0, x: initial.m.s, v: initial.m.v }]);
    play();
  }, [runKey, initial, play]);

  const handleSample = useCallback(
    (s: Sample) => {
      setLive({ t: s.t, m: motionAt(params, s.t) });
      setSeries((prev) => (prev.length > 600 ? prev : [...prev, s]));
    },
    [params],
  );
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const stage = stageFor(params);
  const kmh = (v: number) => `${f0(Math.abs(v) * 3.6)} км/ч`;

  const numbers =
    scenario === "car" && params.maneuver === "brake"
      ? [
          { label: "Время t", value: live.t.toFixed(2), unit: "с" },
          { label: "Пройдено s", value: live.m.s.toFixed(1), unit: "м" },
          { label: "Скорость v", value: live.m.v.toFixed(1), unit: `м/с · ${kmh(live.m.v)}`, color: "#4ade80" },
          { label: "Ускорение a", value: live.m.a.toFixed(1), unit: "м/с²", color: "#f87171" },
          { label: "Путь за реакцию v₀·t_р", value: (params.vCar * params.reaction).toFixed(1), unit: "м" },
          { label: "Тормозной путь v₀²/2a", value: ((params.vCar * params.vCar) / (2 * params.dec)).toFixed(1), unit: "м" },
        ]
      : scenario === "car"
        ? [
            { label: "Время t", value: live.t.toFixed(2), unit: "с" },
            { label: "Пройдено s", value: live.m.s.toFixed(1), unit: "м" },
            { label: "Скорость v", value: live.m.v.toFixed(1), unit: `м/с · ${kmh(live.m.v)}`, color: "#4ade80" },
            { label: "Ускорение a", value: live.m.a.toFixed(1), unit: "м/с²", color: "#f87171" },
            { label: "0 → 100 км/ч за", value: (100 / 3.6 / params.aCar).toFixed(1), unit: "с" },
          ]
        : scenario === "sprinter"
          ? [
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Пробежал s", value: live.m.s.toFixed(1), unit: "м" },
              { label: "Скорость v", value: live.m.v.toFixed(1), unit: `м/с · ${kmh(live.m.v)}`, color: "#4ade80" },
              { label: "Ускорение a", value: live.m.a.toFixed(1), unit: "м/с²", color: "#f87171" },
              { label: "Время на 100 м", value: sprintTimes(params.aSprint, params.vMax).tf.toFixed(2), unit: "с" },
            ]
          : [
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Координата x", value: live.m.s.toFixed(2), unit: "м" },
              { label: "Скорость v", value: live.m.v.toFixed(2), unit: "м/с", color: "#4ade80" },
              { label: "Ускорение a", value: params.a.toFixed(2), unit: "м/с²", color: "#f87171" },
            ];

  const legend: LegendItem[] = [
    { color: "#4ade80", label: "скорость v" },
    { color: "#f87171", label: "ускорение a" },
    { color: "#c084fc", label: scenario === "sprinter" ? "отметка каждую 1 с" : "отметка каждые 0,5 с", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={stage.camera} orbitTarget={stage.target} simplified={isMobile} maxDistance={stage.max} minDistance={stage.min} bloomThreshold={0.6} fogRange={stage.fog}>
          <KinematicsScene
            key={runKey}
            params={params}
            running={clock.running}
            speed={clock.speed}
            simplified={isMobile}
            onSample={handleSample}
            onFinished={handleFinished}
          />
        </SceneCanvas>
      }
      legend={legend}
      caption={captionFor(params, live, surface)}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={<NumberReadouts items={numbers} />}
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">{scenario === "abstract" ? "x(t) — координата" : "s(t) — пройденный путь"}</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "x", color: "#c084fc", label: scenario === "abstract" ? "x, м" : "s, м" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">v(t) — скорость</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "v", color: "#4ade80", label: "v, м/с" }]} />
          </div>
        </div>
      }
      note={
        scenario === "car" && params.maneuver === "brake" ? (
          <>
            Остановочный путь состоит из двух частей. Пока водитель реагирует (≈1 с), машина едет равномерно: s₁ = v₀·t_р.
            Затем — равнозамедленное движение до остановки: s₂ = v₀²/(2a). Скорость входит в квадрате: на 90 км/ч вместо 60
            тормозной путь вырастает в 2,25 раза, а на льду — ещё в несколько раз. Ускорение торможения ≈ μg: сухой асфальт
            μ≈0,7, мокрый ≈0,4, снег ≈0,2, лёд ≈0,1.
          </>
        ) : scenario === "car" ? (
          <>
            Разгон с места — равноускоренное движение: v = at, s = at²/2. Отметки на дороге ставятся каждые 0,5 с: расстояние
            между ними растёт, потому что за каждый следующий интервал машина едет быстрее. Типичный легковой автомобиль
            разгоняется с a ≈ 2,5–3,5 м/с² (0→100 км/ч за 8–11 с).
          </>
        ) : scenario === "sprinter" ? (
          <>
            Забег на 100 м — два участка: разгон (v = at, s = at²/2) до максимальной скорости, затем почти равномерный бег.
            График v(t) — сначала наклонная прямая, потом горизонталь. У элитных спринтеров a ≈ 3–3,5 м/с² и v_max ≈ 11–12 м/с —
            отсюда время около 10 с.
          </>
        ) : (
          <>
            x(t) = x₀ + v₀t {params.a !== 0 ? "+ ½at²" : ""} · v(t) = v₀ {params.a !== 0 ? "+ at" : ""}. Отметки на полу
            ставятся каждые 0,5 с: одинаковый шаг — равномерное движение, растущий — разгон, уменьшающийся — торможение.
            Тележка останавливается у края ленты (±{HALF_TRACK} м) или при t = {CART_MAX_T} с.
          </>
        )
      }
    />
  );
}
