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
import { CameraFollow } from "@/components/sim/CameraFollow";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ramp, Rod, WoodenCrate, type RodHandle } from "@/components/sim/props/mechanics";
import { Person } from "@/components/sim/props/Person";
import { PULL, STAND, walkPose, type PoseAngles } from "@/components/sim/props/pose";
import { Ground, type SurfaceKind } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const G = 9.8;
const RAMP_LEN = 6;
const CRATE = 0.55;
const V_SCALE = 0.3;
const A_SCALE = 0.4;
const FORCE_SCALE = 0.035;
const C_MG = "#facc15";
const C_N = "#60a5fa";
const C_F = "#fb923c";
const C_PULL = "#c084fc";

interface SamplePoint {
  t: number;
  s: number;
  v: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  s: number;
  v: number;
  a: number;
  N: number;
  f: number;
  sliding: boolean;
  done: boolean;
}

/* ---------------- crate sliding down a loading ramp ---------------- */

interface RampProps {
  alphaDeg: number;
  mu: number;
  m: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onFinished: () => void;
}

function SceneRamp({ alphaDeg, mu, m, running, speed, onSample, onLive, onFinished }: RampProps) {
  const alpha = (alphaDeg * Math.PI) / 180;
  const sliding = Math.tan(alpha) > mu;
  const a = sliding ? G * (Math.sin(alpha) - mu * Math.cos(alpha)) : 0;
  const N = m * G * Math.cos(alpha);
  const f = sliding ? mu * N : m * G * Math.sin(alpha);
  const run = RAMP_LEN * Math.cos(alpha);
  const rise = RAMP_LEN * Math.sin(alpha);
  const travel = RAMP_LEN - CRATE - 0.15;

  const crate = useRef<THREE.Group>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const aArrow = useRef<VectorArrowHandle>(null);
  const gArrow = useRef<VectorArrowHandle>(null);
  const nArrow = useRef<VectorArrowHandle>(null);
  const fArrow = useRef<VectorArrowHandle>(null);
  const finished = useRef(false);

  const along = useMemo(() => new THREE.Vector2(Math.cos(alpha), -Math.sin(alpha)), [alpha]);
  const normal = useMemo(() => new THREE.Vector2(Math.sin(alpha), Math.cos(alpha)), [alpha]);

  const place = useCallback(
    (s: number) => {
      const sx = -run + along.x * (s + CRATE / 2 + 0.08) + normal.x * (CRATE / 2);
      const sy = rise + along.y * (s + CRATE / 2 + 0.08) + normal.y * (CRATE / 2);
      return { x: sx, y: sy };
    },
    [run, rise, along, normal],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const s = Math.min(0.5 * a * t * t, travel);
      const v = s >= travel ? Math.sqrt(2 * a * travel) : a * t;
      const p = place(s);
      if (crate.current) crate.current.position.set(p.x, p.y, 0);
      vArrow.current?.set([p.x, p.y + 0.55, 0.45], [along.x * v * V_SCALE, along.y * v * V_SCALE, 0]);
      aArrow.current?.set([p.x, p.y + 0.95, 0.45], [along.x * a * A_SCALE, along.y * a * A_SCALE, 0]);
      gArrow.current?.set([p.x, p.y, 0.35], [0, -m * G * FORCE_SCALE, 0]);
      nArrow.current?.set([p.x - normal.x * (CRATE / 2), p.y - normal.y * (CRATE / 2), 0.35], [normal.x * N * FORCE_SCALE, normal.y * N * FORCE_SCALE, 0]);
      fArrow.current?.set([p.x - normal.x * (CRATE / 2), p.y - normal.y * (CRATE / 2), 0.4], [-along.x * f * FORCE_SCALE, -along.y * f * FORCE_SCALE, 0]);
      if (!finished.current && s >= travel) {
        finished.current = true;
        onLive({ t, s, v, a, N, f, sliding, done: true });
        onFinished();
      }
    },
    [a, travel, place, along, normal, m, N, f, sliding, onLive, onFinished],
  );

  // a crate that cannot slide still has its forces drawn
  useEffect(() => {
    if (!sliding) handleFrame(0);
  }, [sliding, handleFrame]);

  return (
    <>
      <PhysicsTicker
        running={running && sliding}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const s = Math.min(0.5 * a * t * t, travel);
          const v = s >= travel ? Math.sqrt(2 * a * travel) : a * t;
          onSample({ t, s, v });
          onLive({ t, s, v, a, N, f, sliding, done: s >= travel });
        }}
      />
      <Ground kind="concrete" from={-12} to={8} width={12} tile={3} tileZ={3} y={-0.01} />
      {/* loading dock the ramp leans on */}
      <mesh position={[-run - 1.6, rise / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, rise, 3]} />
        <meshStandardMaterial color="#57534e" roughness={0.9} />
      </mesh>
      <mesh position={[-run - 1.6, rise + 0.03, 0]}>
        <boxGeometry args={[3.2, 0.06, 3]} />
        <meshStandardMaterial color="#facc15" roughness={0.7} />
      </mesh>
      <Ramp angleDeg={alphaDeg} length={RAMP_LEN} width={1.3} />
      <group ref={crate} rotation={[0, 0, -alpha]} position={[place(0).x, place(0).y, 0]}>
        <WoodenCrate size={[CRATE, CRATE, CRATE]} label={`${m} кг`} />
      </group>
      <SceneLabel position={[-run / 2, rise / 2 - 0.5, 0.9]}>{`пандус, α = ${alphaDeg}°`}</SceneLabel>
      <VectorArrow ref={vArrow} color="#4ade80" />
      <VectorArrow ref={aArrow} color="#f87171" />
      <VectorArrow ref={gArrow} color={C_MG} />
      <VectorArrow ref={nArrow} color={C_N} />
      <VectorArrow ref={fArrow} color={C_F} />
    </>
  );
}

/* ---------------- person pulling a crate with a rope ---------------- */

const ROPE_TRACK = 7;
const HAND_H = 1.12;

interface RopeSceneProps {
  F: number;
  thetaDeg: number;
  mu: number;
  m: number;
  surface: SurfaceKind;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onFinished: () => void;
}

function SceneRope({ F, thetaDeg, mu, m, surface, running, speed, onSample, onLive, onFinished }: RopeSceneProps) {
  const theta = (thetaDeg * Math.PI) / 180;
  const N = Math.max(0, m * G - F * Math.sin(theta));
  const netH = F * Math.cos(theta) - mu * N;
  const sliding = netH > 0;
  const a = sliding ? netH / m : 0;
  const f = sliding ? mu * N : Math.min(F * Math.cos(theta), mu * N);

  const pullY = CRATE * 0.75;
  // the rope runs from the crate to the hands; its angle fixes how far ahead the person stands
  const reach = Math.min(4, (HAND_H - pullY) / Math.max(Math.tan(theta), 1e-3));
  const handY = pullY + reach * Math.tan(theta);

  const crate = useRef<THREE.Group>(null!);
  const person = useRef<THREE.Group>(null!);
  const rope = useRef<RodHandle>(null);
  const poseRef = useRef<PoseAngles>(STAND);
  const pArrow = useRef<VectorArrowHandle>(null);
  const nArrow = useRef<VectorArrowHandle>(null);
  const gArrow = useRef<VectorArrowHandle>(null);
  const fArrow = useRef<VectorArrowHandle>(null);
  const vArrow = useRef<VectorArrowHandle>(null);
  const finished = useRef(false);

  const handleFrame = useCallback(
    (t: number) => {
      const s = Math.min(0.5 * a * t * t, ROPE_TRACK);
      const v = a * t;
      if (crate.current) crate.current.position.x = s;
      const px = s + CRATE / 2;
      const hx = px + reach;
      if (person.current) person.current.position.x = hx + 0.45;
      rope.current?.set([px, pullY, 0], [hx, handY, 0]);
      const walk = walkPose(-(s / 1.3) * Math.PI * 2);
      poseRef.current = {
        ...(sliding ? walk : STAND),
        shoulderL: PULL.shoulderL + (handY - HAND_H) * 1.2,
        shoulderR: PULL.shoulderR + (handY - HAND_H) * 1.2,
        elbowL: PULL.elbowL,
        elbowR: PULL.elbowR,
        spreadL: 0.1,
        spreadR: 0.1,
        lean: PULL.lean,
      };
      pArrow.current?.set([px, pullY, 0.32], [Math.cos(theta) * F * FORCE_SCALE * 1.5, Math.sin(theta) * F * FORCE_SCALE * 1.5, 0]);
      nArrow.current?.set([s, 0.02, 0.32], [0, N * FORCE_SCALE, 0]);
      gArrow.current?.set([s, CRATE / 2, 0.36], [0, -m * G * FORCE_SCALE, 0]);
      fArrow.current?.set([s - CRATE / 2, 0.04, 0.32], [-f * FORCE_SCALE * 1.5, 0, 0]);
      vArrow.current?.set([s, CRATE + 0.45, 0], [v * V_SCALE, 0, 0]);
      if (!finished.current && s >= ROPE_TRACK) {
        finished.current = true;
        onLive({ t, s, v, a, N, f, sliding, done: true });
        onFinished();
      }
    },
    [a, reach, pullY, handY, sliding, theta, F, N, m, f, onLive, onFinished],
  );

  useEffect(() => {
    if (!sliding) handleFrame(0);
  }, [sliding, handleFrame]);

  return (
    <>
      <PhysicsTicker
        running={running && sliding}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const s = Math.min(0.5 * a * t * t, ROPE_TRACK);
          onSample({ t, s, v: a * t });
          onLive({ t, s, v: a * t, a, N, f, sliding, done: s >= ROPE_TRACK });
        }}
      />
      <Ground kind={surface} from={-6} to={ROPE_TRACK + 10} width={10} tile={surface === "ice" ? 8 : 3} tileZ={surface === "ice" ? 10 : 3} y={-0.01} />
      <group ref={crate} position={[0, CRATE / 2, 0]}>
        <WoodenCrate size={[CRATE, CRATE, CRATE]} label={`${m} кг`} />
      </group>
      <group ref={person} position={[CRATE / 2 + reach + 0.45, 0, 0]}>
        <Person rotation={[0, -Math.PI / 2, 0]} poseRef={poseRef} shirt="#16a34a" pants="#1e3a8a" />
      </group>
      <Rod ref={rope} radius={0.016} color="#d6c08f" />
      <SceneLabel position={[0, CRATE + 1.0, 0]}>{`верёвка под углом θ = ${thetaDeg}°`}</SceneLabel>
      <CameraFollow target={crate} lead={1.6} min={0} max={ROPE_TRACK} />
      <VectorArrow ref={pArrow} color={C_PULL} />
      <VectorArrow ref={nArrow} color={C_N} />
      <VectorArrow ref={gArrow} color={C_MG} />
      <VectorArrow ref={fArrow} color={C_F} />
      <VectorArrow ref={vArrow} color="#4ade80" />
    </>
  );
}

/* ------------------------------------------------------------------ */

const SURFACE_KIND: Record<string, SurfaceKind> = { "0.05": "ice", "0.6": "asphalt", "0.9": "concrete" };
const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function ForcesFrictionElasticitySim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, alphaDeg, mu, m, F, thetaDeg, surfaceMu } = useControls("Наклонная плоскость", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Ящик съезжает по пандусу": "abstract", "Человек тянет ящик на верёвке": "rope" },
    },
    alphaDeg: { value: 30, min: 5, max: 60, step: 1, label: "угол пандуса α, °", render: (get) => get("Наклонная плоскость.scenario") === "abstract" },
    mu: { value: 0.2, min: 0, max: 1, step: 0.01, label: "μ (трение)", render: (get) => get("Наклонная плоскость.scenario") === "abstract" },
    m: { value: 2, min: 0.5, max: 5, step: 0.1, label: "m ящика, кг" },
    F: { value: 15, min: 2, max: 30, step: 0.5, label: "F, Н (тяга верёвки)", render: (get) => get("Наклонная плоскость.scenario") === "rope" },
    thetaDeg: { value: 20, min: 0, max: 70, step: 1, label: "θ, ° (угол верёвки)", render: (get) => get("Наклонная плоскость.scenario") === "rope" },
    surfaceMu: {
      value: 0.6,
      label: "Покрытие",
      options: { "Лёд (μ≈0.05)": 0.05, "Асфальт, сухой (μ≈0.6)": 0.6, "Резина по бетону (μ≈0.9)": 0.9 },
      render: (get) => get("Наклонная плоскость.scenario") === "rope",
    },
  });

  const rope = scenario === "rope";
  const alpha = (alphaDeg * Math.PI) / 180;
  const slidingRamp = Math.tan(alpha) > mu;
  const aRamp = slidingRamp ? G * (Math.sin(alpha) - mu * Math.cos(alpha)) : 0;
  const NRamp = m * G * Math.cos(alpha);
  const fRamp = slidingRamp ? mu * NRamp : m * G * Math.sin(alpha);

  const theta = (thetaDeg * Math.PI) / 180;
  const NRope = Math.max(0, m * G - F * Math.sin(theta));
  const netH = F * Math.cos(theta) - surfaceMu * NRope;
  const slidingRope = netH > 0;
  const aRope = slidingRope ? netH / m : 0;
  const fRope = slidingRope ? surfaceMu * NRope : Math.min(F * Math.cos(theta), surfaceMu * NRope);
  const thetaOptDeg = (Math.atan(surfaceMu) * 180) / Math.PI;
  // least pull needed to start the crate, reached at θ_opt
  const Fmin = (surfaceMu * m * G) / Math.sqrt(1 + surfaceMu * surfaceMu);

  const a = rope ? aRope : aRamp;
  const N = rope ? NRope : NRamp;
  const f = rope ? fRope : fRamp;
  const sliding = rope ? slidingRope : slidingRamp;

  const runKey = `${clock.resetNonce}|${scenario}|${alphaDeg}|${mu}|${m}|${F}|${thetaDeg}|${surfaceMu}`;
  const [live, setLive] = useState<LiveNumbers>({ t: 0, s: 0, v: 0, a, N, f, sliding, done: false });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, s: 0, v: 0 }]);
  const play = clock.play;
  useEffect(() => {
    setLive({ t: 0, s: 0, v: 0, a, N, f, sliding, done: false });
    setSeries([{ t: 0, s: 0, v: 0 }]);
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev : [...prev, p]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const along = m * G * Math.sin(alpha);
  let caption;
  if (rope) {
    const horiz = F * Math.cos(theta);
    caption = !slidingRope ? (
      <>
        <b>Ящик не сдвинулся:</b> вперёд тянет Fcosθ = {f1(horiz)} Н, а трение покоя может дать до μN = {f1(surfaceMu * NRope)} Н. Нужно хотя бы {f1(Fmin)} Н — при угле θ ≈ {thetaOptDeg.toFixed(0)}°.
      </>
    ) : live.done ? (
      <>Ящик протащили {ROPE_TRACK} м за {f1(live.t)} с. Попробуйте другой угол верёвки: при θ ≈ {thetaOptDeg.toFixed(0)}° тянуть легче всего.</>
    ) : (
      <>
        <b>Едет!</b> Вперёд тянет Fcosθ = {f1(horiz)} Н, назад — трение f = μN = {f1(fRope)} Н. Верёвка под углом ещё и чуть приподнимает ящик: N = mg − Fsinθ = {f1(NRope)} Н,
        поэтому трение меньше.
      </>
    );
  } else {
    caption = !slidingRamp ? (
      <>
        <b>Ящик стоит:</b> вниз по пандусу его тянет mg·sinα = {f1(along)} Н, но трение покоя (до μN = {f1(mu * NRamp)} Н) его удерживает. Поедет при α &gt; arctg μ ={" "}
        {((Math.atan(mu) * 180) / Math.PI).toFixed(0)}°.
      </>
    ) : live.done ? (
      <>Ящик съехал за {f1(live.t)} с и внизу набрал скорость {f1(live.v)} м/с.</>
    ) : (
      <>
        <b>Ящик скользит:</b> вниз его тянет mg·sinα = {f1(along)} Н, трение f = μN = {f1(fRamp)} Н мешает. Разница даёт ускорение a = g(sinα − μcosα) = {f2(aRamp)} м/с².
      </>
    );
  }

  const legend: LegendItem[] = [
    { color: C_MG, label: "mg — сила тяжести" },
    { color: C_N, label: "N — реакция опоры" },
    { color: C_F, label: "f — трение" },
    ...(rope ? [{ color: C_PULL, label: "F — тяга верёвки" }] : [{ color: "#f87171", label: "ускорение a" }]),
    { color: "#4ade80", label: "скорость v" },
  ];

  const stage = rope
    ? { camera: [1.5, 2.6, 7] as [number, number, number], target: [1.6, 0.7, 0] as [number, number, number] }
    : { camera: [-1.8, 2.4 + RAMP_LEN * Math.sin(alpha) * 0.4, 8.5] as [number, number, number], target: [-RAMP_LEN * Math.cos(alpha) * 0.45, RAMP_LEN * Math.sin(alpha) * 0.4, 0] as [number, number, number] };

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={{ position: stage.camera, fov: 50 }} orbitTarget={stage.target} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.6} fogRange={[16, 45]}>
          {rope ? (
            <SceneRope
              key={runKey}
              F={F}
              thetaDeg={thetaDeg}
              mu={surfaceMu}
              m={m}
              surface={SURFACE_KIND[String(surfaceMu)] ?? "asphalt"}
              running={clock.running}
              speed={clock.speed}
              onSample={handleSample}
              onLive={setLive}
              onFinished={handleFinished}
            />
          ) : (
            <SceneRamp
              key={runKey}
              alphaDeg={alphaDeg}
              mu={mu}
              m={m}
              running={clock.running}
              speed={clock.speed}
              onSample={handleSample}
              onLive={setLive}
              onFinished={handleFinished}
            />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        <NumberReadouts
          items={[
            { label: "Время t", value: live.t.toFixed(2), unit: "с" },
            { label: "Путь s", value: live.s.toFixed(2), unit: "м" },
            { label: "Скорость v", value: live.v.toFixed(2), unit: "м/с", color: "#4ade80" },
            { label: "Ускорение a", value: a.toFixed(2), unit: "м/с²", color: "#f87171" },
            { label: "Сила реакции N", value: N.toFixed(2), unit: "Н", color: C_N },
            { label: "Сила трения f", value: f.toFixed(2), unit: "Н", color: C_F },
            ...(rope ? [{ label: "Оптимальный угол θ_opt = arctg μ", value: thetaOptDeg.toFixed(1), unit: "°", color: "#5eead4" }] : []),
          ]}
        />
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">s(t) и v(t)</p>
          <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "s", color: "#c084fc", label: "s, м" }, { key: "v", color: "#4ade80", label: "v, м/с" }]} />
        </div>
      }
      note={
        rope ? (
          <>
            N = mg − Fsinθ, движение начинается при Fcosθ &gt; μN. Угол θ_opt = arctg(μ) требует наименьшей силы F для сдвига
            ящика: подъём верёвки разгружает опору (и уменьшает трение), но одновременно уменьшает горизонтальную составляющую
            тяги — оптимум балансирует эти два эффекта. На льду (μ≈0,05) выгоднее тянуть почти горизонтально.
          </>
        ) : (
          <>
            Сила тяжести раскладывается на две части: mg·sinα тянет ящик вдоль пандуса, mg·cosα прижимает его к доске (её
            уравновешивает N). Трение скольжения f = μN = μmg·cosα. Отсюда a = g(sinα − μcosα); при α = 30°, μ = 0,2 → a ≈ 3,20 м/с²
            (как в разобранном примере конспекта). Если tgα ≤ μ, трение покоя удерживает ящик.
          </>
        )
      }
    />
  );
}
