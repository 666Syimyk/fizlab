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
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ramp, Rod, type RodHandle } from "@/components/sim/props/mechanics";
import { SteelBall } from "@/components/sim/props/sport";
import { Dynamometer } from "@/components/sim/props/vehicles";
import { Person } from "@/components/sim/props/Person";
import { spinPose, type PoseAngles } from "@/components/sim/props/pose";
import { Ground } from "@/components/sim/props/environment";
import { canvasTexture, woodTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const V_SCALE = 0.25;
const F_SCALE = 0.12;
const AXLE_H = 1.5;

interface SamplePoint {
  t: number;
  omega: number;
  L: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  phi: number;
  omega: number;
  L: number;
}

/* ---------------- flywheel spun up by pulling a rope ---------------- */

function flywheelTexture() {
  return canvasTexture("flywheel-face", 256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    g.addColorStop(0, "#e2e8f0");
    g.addColorStop(1, "#94a3b8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    for (let r = 20; r < w / 2; r += 9) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(w / 2 - 6, 10, 12, h / 2 - 20);
  });
}

interface FlywheelProps {
  F: number;
  R: number;
  m: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneFlywheel({ F, R, m, running, speed, onSample, onLive }: FlywheelProps) {
  const I = 0.5 * m * R * R;
  const eps = (F * R) / I;
  const wheel = useRef<THREE.Group>(null!);
  const rope = useRef<RodHandle>(null);
  const scale = useRef<THREE.Group>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const fArrow = useRef<VectorArrowHandle>(null);
  const face = useMemo(() => flywheelTexture(), []);
  const thick = 0.12 + 0.05 * m;

  const handleFrame = useCallback(
    (t: number) => {
      const phi = 0.5 * eps * t * t;
      const omega = eps * t;
      if (wheel.current) wheel.current.rotation.z = -phi;
      // the rope unwinds from the right side of the rim: its end goes down by R·φ
      const drop = Math.min(0.55 + R * phi, AXLE_H - 0.5);
      rope.current?.set([R, AXLE_H, 0.02], [R, AXLE_H - drop, 0.02]);
      if (scale.current) scale.current.position.set(R, AXLE_H - drop - 0.3, 0.02);
      fArrow.current?.set([R + 0.18, AXLE_H, 0.1], [0, -F * F_SCALE, 0]);
      // a mark on the rim
      const a = -phi + Math.PI / 2;
      const mx = R * Math.cos(a);
      const my = AXLE_H + R * Math.sin(a);
      vArrow.current?.set([mx, my, thick / 2 + 0.05], [Math.sin(a) * omega * R * V_SCALE, -Math.cos(a) * omega * R * V_SCALE, 0]);
    },
    [eps, R, F, thick],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const phi = 0.5 * eps * t * t;
          const omega = eps * t;
          onSample({ t, omega, L: I * omega });
          onLive({ t, phi, omega, L: I * omega });
        }}
      />
      <Ground kind="tiles" from={-5} to={5} width={6} tile={2} tileZ={2} y={-0.01} />
      {/* stand */}
      {/* single post behind the wheel; the axle sticks out of it */}
      <mesh position={[0, AXLE_H / 2, -(thick / 2 + 0.22)]} castShadow>
        <boxGeometry args={[0.14, AXLE_H, 0.1]} />
        <meshStandardMaterial color="#1e3a8a" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.04, -(thick / 2 + 0.22)]}>
        <boxGeometry args={[1.2, 0.08, 0.6]} />
        <meshStandardMaterial color="#1e3a8a" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, AXLE_H, -0.12]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, thick + 0.4, 12]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
      </mesh>
      <group ref={wheel} position={[0, AXLE_H, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[R, R, thick, 48]} />
          <meshStandardMaterial attach="material-0" color="#94a3b8" metalness={0.7} roughness={0.35} />
          <meshStandardMaterial attach="material-1" map={face} metalness={0.4} roughness={0.45} />
          <meshStandardMaterial attach="material-2" map={face} metalness={0.4} roughness={0.45} />
        </mesh>
      </group>
      <Rod ref={rope} radius={0.012} color="#d6c08f" />
      <group ref={scale}>
        <Dynamometer rotation={[0, 0, Math.PI / 2]} length={0.4} stretch={F / 15} />
      </group>
      <SceneLabel position={[0, AXLE_H + R + 0.35, 0]}>{`маховик, m = ${m} кг`}</SceneLabel>
      <SceneLabel position={[R + 0.75, AXLE_H - 0.6, 0]}>тянем верёвку с силой F</SceneLabel>
      <VectorArrow ref={vArrow} color="#4ade80" />
      <VectorArrow ref={fArrow} color="#f87171" />
    </>
  );
}

/* ---------------- race down a slope: ball vs log vs hoop ---------------- */

const RACE_ALPHA_DEG = 25;
const RACE_ALPHA = (RACE_ALPHA_DEG * Math.PI) / 180;
const RACE_LEN = 7;
const RACE_R = 0.35;

interface RaceLive {
  t: number;
  finishedSphere: number | null;
  finishedCylinder: number | null;
  finishedHoop: number | null;
}

function hoopTexture() {
  return canvasTexture("hula-hoop", 256, 16, (ctx, w, h) => {
    const colors = ["#ef4444", "#facc15", "#22c55e", "#3b82f6"];
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = colors[i % 4];
      ctx.fillRect((i / 16) * w, 0, w / 16, h);
    }
  });
}

function SceneRace({ running, speed, onLive, onFinished }: { running: boolean; speed: number; onLive: (n: RaceLive) => void; onFinished: () => void }) {
  const shapes = useMemo(
    () => [
      { key: "sphere", k: 2 / 5, z: -0.9 },
      { key: "cylinder", k: 1 / 2, z: 0 },
      { key: "hoop", k: 1, z: 0.9 },
    ],
    [],
  );
  const refs = useRef<(THREE.Group | null)[]>([]);
  const finishTimes = useRef<Record<string, number | null>>({ sphere: null, cylinder: null, hoop: null });
  const finishedRef = useRef(false);
  const run = RACE_LEN * Math.cos(RACE_ALPHA);
  const rise = RACE_LEN * Math.sin(RACE_ALPHA);
  const wood = woodTexture("medium", 2);
  const hoop = useMemo(() => hoopTexture(), []);
  const travel = RACE_LEN - 0.6;

  const emit = useCallback(
    (t: number) => onLive({ t, finishedSphere: finishTimes.current.sphere, finishedCylinder: finishTimes.current.cylinder, finishedHoop: finishTimes.current.hoop }),
    [onLive],
  );

  const handleFrame = useCallback(
    (t: number) => {
      shapes.forEach((shape, i) => {
        const ai = (Math.sin(RACE_ALPHA) * 9.8) / (1 + shape.k);
        const s = Math.min(0.5 * ai * t * t, travel) + 0.4;
        const phi = s / RACE_R;
        const px = -run + Math.cos(RACE_ALPHA) * s + Math.sin(RACE_ALPHA) * RACE_R;
        const py = rise - Math.sin(RACE_ALPHA) * s + Math.cos(RACE_ALPHA) * RACE_R;
        const group = refs.current[i];
        if (group) {
          group.position.set(px, py, shape.z);
          group.rotation.z = -phi;
        }
        if (s - 0.4 >= travel && finishTimes.current[shape.key] === null) finishTimes.current[shape.key] = t;
      });
      if (!finishedRef.current && Object.values(finishTimes.current).every((v) => v !== null)) {
        finishedRef.current = true;
        emit(t);
        onFinished();
      }
    },
    [shapes, run, rise, travel, emit, onFinished],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={20} onSample={emit} />
      <Ground kind="tiles" from={-10} to={6} width={8} tile={2} tileZ={2} y={-0.01} />
      <Ramp angleDeg={RACE_ALPHA_DEG} length={RACE_LEN} width={2.8} />
      {[-0.45, 0.45].map((z) => (
        <mesh key={z} position={[-run / 2, rise / 2 + 0.06, z]} rotation={[0, 0, -RACE_ALPHA]}>
          <boxGeometry args={[RACE_LEN, 0.12, 0.04]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0.3, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.12, 2.8]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.4} />
      </mesh>
      <SceneLabel position={[0.3, 0.35, 1.6]}>финиш</SceneLabel>
      {shapes.map((shape, i) => (
        <group
          key={shape.key}
          ref={(g) => {
            refs.current[i] = g;
          }}
        >
          {shape.key === "sphere" && <SteelBall radius={RACE_R} />}
          {shape.key === "cylinder" && (
            <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[RACE_R, RACE_R, 0.5, 28]} />
              <meshStandardMaterial attach="material-0" map={wood} roughness={0.85} />
              <meshStandardMaterial attach="material-1" color="#d6a868" roughness={0.8} />
              <meshStandardMaterial attach="material-2" color="#d6a868" roughness={0.8} />
            </mesh>
          )}
          {shape.key === "hoop" && (
            <mesh castShadow>
              <torusGeometry args={[RACE_R - 0.03, 0.035, 10, 40]} />
              <meshStandardMaterial map={hoop} roughness={0.5} />
            </mesh>
          )}
        </group>
      ))}
      {shapes.map((shape) => (
        <SceneLabel key={shape.key} position={[-run - 0.6, rise + 0.7 + (shape.key === "sphere" ? 0.9 : shape.key === "cylinder" ? 0.45 : 0), shape.z]} tone={shape.key === "sphere" ? "#d4d4d8" : shape.key === "cylinder" ? "#d6a868" : "#ef4444"}>
          {shape.key === "sphere" ? "стальной шар" : shape.key === "cylinder" ? "полено (цилиндр)" : "обруч"}
        </SceneLabel>
      ))}
    </>
  );
}

/* ---------------- figure skater ---------------- */

const ARM_R_MIN = 0.15;
const ARM_R_MAX = 0.65;
const SKATER_I0 = 0.35;
const ARM_MASS = 2.5;

function SceneSkater({ L, armExt, running, speed, onLive }: { L: number; armExt: number; running: boolean; speed: number; onLive: (n: { t: number; omega: number; I: number }) => void }) {
  const bodyRef = useRef<THREE.Group>(null!);
  const phi = useRef(0);
  const armR = ARM_R_MIN + armExt * (ARM_R_MAX - ARM_R_MIN);
  const I = SKATER_I0 + 2 * ARM_MASS * armR * armR;
  const omega = L / I;
  const poseRef = useRef<PoseAngles>(spinPose(armExt));

  const handleFrame = useCallback(
    (_t: number, dt: number) => {
      phi.current += omega * dt;
      if (bodyRef.current) bodyRef.current.rotation.y = -phi.current;
      poseRef.current = { ...spinPose(armExt), hipL: 0.25, kneeL: 0.9 };
    },
    [omega, armExt],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={20} onSample={(t) => onLive({ t, omega, I })} />
      <Ground kind="ice" from={-8} to={8} width={10} tile={8} tileZ={10} y={-0.01} />
      <mesh position={[0, 0.5, -4.2]}>
        <boxGeometry args={[16, 1, 0.12]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.4} />
      </mesh>
      <group ref={bodyRef}>
        <Person position={[0, 0.1, 0]} poseRef={poseRef} skates shirt="#db2777" pants="#db2777" hair="#3b2416" longHair />
      </group>
      <SceneLabel position={[0, 2.25, 0]}>фигуристка</SceneLabel>
    </>
  );
}

/* ------------------------------------------------------------------ */

const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function RotationalDynamicsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, F, R, m, LSkater, armExt } = useControls("Динамика вращения", {
    scenario: {
      value: "race",
      label: "Жизненный пример",
      options: { "Гонка с горки: шар, полено, обруч": "race", "Фигуристка (сохранение L)": "skater", "Маховик: тянем верёвку": "abstract" },
    },
    F: { value: 6, min: 1, max: 15, step: 0.5, label: "F, Н (тяга верёвки)", render: (get) => get("Динамика вращения.scenario") === "abstract" },
    R: { value: 0.5, min: 0.2, max: 1, step: 0.05, label: "R маховика, м", render: (get) => get("Динамика вращения.scenario") === "abstract" },
    m: { value: 4, min: 0.5, max: 8, step: 0.1, label: "m маховика, кг", render: (get) => get("Динамика вращения.scenario") === "abstract" },
    LSkater: { value: 6, min: 2, max: 12, step: 0.5, label: "L, кг·м²/с (сохраняется)", render: (get) => get("Динамика вращения.scenario") === "skater" },
    armExt: { value: 1, min: 0, max: 1, step: 0.01, label: "Раскрытие рук (1=руки в стороны)", render: (get) => get("Динамика вращения.scenario") === "skater" },
  });

  const race = scenario === "race";
  const skater = scenario === "skater";
  const I = 0.5 * m * R * R;
  const torque = F * R;
  const eps = torque / I;

  const runKey = `${clock.resetNonce}|${scenario}|${F}|${R}|${m}`;
  const [live, setLive] = useState<LiveNumbers>({ t: 0, phi: 0, omega: 0, L: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([]);
  const [raceLive, setRaceLive] = useState<RaceLive>({ t: 0, finishedSphere: null, finishedCylinder: null, finishedHoop: null });
  const iOf = (ext: number) => SKATER_I0 + 2 * ARM_MASS * (ARM_R_MIN + ext * (ARM_R_MAX - ARM_R_MIN)) ** 2;
  const [skaterLive, setSkaterLive] = useState({ t: 0, omega: LSkater / iOf(armExt), I: iOf(armExt) });

  const play = clock.play;
  useEffect(() => {
    setLive({ t: 0, phi: 0, omega: 0, L: 0 });
    setSeries([{ t: 0, omega: 0, L: 0 }]);
    setRaceLive({ t: 0, finishedSphere: null, finishedCylinder: null, finishedHoop: null });
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const stage = race
    ? { camera: { position: [-2.4, 3.6, 9] as [number, number, number], fov: 50 }, orbitTarget: [-2.6, 1.2, 0] as [number, number, number] }
    : skater
      ? { camera: { position: [0, 2.0, 5.2] as [number, number, number], fov: 50 }, orbitTarget: [0, 1.0, 0] as [number, number, number] }
      : { camera: { position: [1.2, 2.0, 4.6] as [number, number, number], fov: 50 }, orbitTarget: [0.2, 1.1, 0] as [number, number, number] };

  let caption;
  let legend: LegendItem[];
  if (race) {
    const done = raceLive.finishedHoop !== null && raceLive.finishedCylinder !== null && raceLive.finishedSphere !== null;
    caption = done ? (
      <>
        <b>Финиш:</b> первым шар ({f2(raceLive.finishedSphere ?? 0)} с), вторым полено ({f2(raceLive.finishedCylinder ?? 0)} с), последним обруч ({f2(raceLive.finishedHoop ?? 0)} с). У обруча вся масса на
        ободе — больше всего энергии уходит на вращение.
      </>
    ) : (
      <>
        Все трое стартовали одновременно с одной высоты. Энергия mgh делится между поступательным движением и вращением: чем дальше масса от оси, тем больше уходит
        «в кручение» и тем медленнее тело катится.
      </>
    );
    legend = [
      { color: "#d4d4d8", label: "шар: I = ⅖mR²", kind: "dot" },
      { color: "#d6a868", label: "полено: I = ½mR²", kind: "dot" },
      { color: "#ef4444", label: "обруч: I = mR²", kind: "dot" },
    ];
  } else if (skater) {
    const iOpen = iOf(1);
    const iClosed = iOf(0);
    caption =
      armExt > 0.6 ? (
        <>
          <b>Руки в стороны:</b> момент инерции большой (I = {f2(skaterLive.I)} кг·м²), вращение медленное — ω = {f1(skaterLive.omega)} рад/с. Потяните ползунок «раскрытие рук» к нулю.
        </>
      ) : (
        <>
          <b>Руки прижаты:</b> I уменьшился до {f2(skaterLive.I)} кг·м², а момент импульса L = Iω сохраняется — поэтому ω выросла до {f1(skaterLive.omega)} рад/с (до {f1(iOpen / iClosed)} раза
          быстрее).
        </>
      );
    legend = [];
  } else {
    caption = (
      <>
        Верёвку тянут с силой F = {f1(F)} Н на плече R = {f2(R)} м: момент силы M = FR = {f2(torque)} Н·м. Маховик (I = ½mR² = {f2(I)} кг·м²) раскручивается с угловым ускорением
        ε = M/I = {f1(eps)} рад/с² — ω растёт равномерно.
      </>
    );
    legend = [
      { color: "#f87171", label: "сила F" },
      { color: "#4ade80", label: "скорость точки обода" },
    ];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={stage.camera} orbitTarget={stage.orbitTarget} simplified={isMobile} maxDistance={18} minDistance={2} bloomThreshold={0.6} fogRange={[14, 40]}>
          {race ? (
            <SceneRace key={runKey} running={clock.running} speed={clock.speed} onLive={setRaceLive} onFinished={handleFinished} />
          ) : skater ? (
            <SceneSkater key={runKey} L={LSkater} armExt={armExt} running={clock.running} speed={clock.speed} onLive={setSkaterLive} />
          ) : (
            <SceneFlywheel key={runKey} F={F} R={R} m={m} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        race ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: raceLive.t.toFixed(2), unit: "с" },
              { label: "Шар финиш (k=2/5)", value: raceLive.finishedSphere?.toFixed(2) ?? "—", unit: "с", color: "#d4d4d8" },
              { label: "Полено финиш (k=1/2)", value: raceLive.finishedCylinder?.toFixed(2) ?? "—", unit: "с", color: "#d6a868" },
              { label: "Обруч финиш (k=1)", value: raceLive.finishedHoop?.toFixed(2) ?? "—", unit: "с", color: "#ef4444" },
            ]}
          />
        ) : skater ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: skaterLive.t.toFixed(2), unit: "с" },
              { label: "Момент инерции I", value: skaterLive.I.toFixed(3), unit: "кг·м²" },
              { label: "Угл. скорость ω=L/I", value: skaterLive.omega.toFixed(2), unit: "рад/с", color: "#4ade80" },
              { label: "Оборотов в секунду", value: (skaterLive.omega / (2 * Math.PI)).toFixed(2), unit: "об/с" },
              { label: "Момент импульса L", value: LSkater.toFixed(2), unit: "кг·м²/с (const)" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "Момент инерции I", value: I.toFixed(3), unit: "кг·м²" },
              { label: "Момент силы M", value: torque.toFixed(2), unit: "Н·м" },
              { label: "Угл. ускорение ε=M/I", value: eps.toFixed(2), unit: "рад/с²" },
              { label: "Угл. скорость ω", value: live.omega.toFixed(2), unit: "рад/с" },
              { label: "Момент импульса L=Iω", value: live.L.toFixed(3), unit: "кг·м²/с" },
            ]}
          />
        )
      }
      graphs={
        race || skater ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            {race
              ? "Шар (k=2/5) обгоняет полено (k=1/2), а оно — обруч (k=1): a = g·sinα/(1+k). Чем больше момент инерции относительно mR², тем медленнее разгон — независимо от массы и радиуса тела."
              : "Потяните ползунок «раскрытие рук» — момент импульса L = Iω сохраняется, поэтому при уменьшении I (руки прижаты) угловая скорость ω сразу растёт."}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">ω(t) и L(t)</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "omega", color: "#4ade80", label: "ω, рад/с" }, { key: "L", color: "#c084fc", label: "L, кг·м²/с" }]} />
          </div>
        )
      }
      note={
        race ? (
          <>
            Для тела, катящегося без проскальзывания по наклонной плоскости, a = g·sinα/(1+k), где k = I/(mR²): шар k = 2/5,
            сплошной цилиндр (полено) k = 1/2, обруч k = 1. Масса и радиус не влияют на результат гонки — только распределение
            массы относительно оси.
          </>
        ) : skater ? (
          <>
            Момент импульса L = Iω сохраняется без внешнего момента сил. Прижимая руки, фигуристка уменьшает свой момент инерции
            I — и угловая скорость ω = L/I автоматически растёт: классический пример сохранения момента импульса. Так же
            ускоряется пловец, прыгающий «бомбочкой», и кошка в падении.
          </>
        ) : (
          <>
            Момент силы M = FR разгоняет маховик (сплошной диск, I = ½mR²) с угловым ускорением ε = M/I. Красная стрелка — сила
            натяжения верёвки, зелёная — линейная скорость точки обода v = ωR. Тяжёлый маховик раскрутить труднее — так он
            запасает энергию в двигателях и игрушечных машинках с инерционным ходом.
          </>
        )
      }
    />
  );
}
