import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { CuboidCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LabCart } from "@/components/sim/props/vehicles";
import { Rod, type RodHandle } from "@/components/sim/props/mechanics";
import { SteelBall } from "@/components/sim/props/sport";
import { Ground, LabBench } from "@/components/sim/props/environment";
import { woodTexture } from "@/components/sim/props/textures";

const RAIL_HALF = 6.5;
const RAIL_Y = 0.5;
const X1_0 = -3.5;
const X2_0 = 1;
const V_SCALE = 0.28;
const COLOR1 = "#7c6cf5";
const COLOR2 = "#fbbf24";
const POST_COLLISION_HOLD = 3;
const MAX_TIME = 14;

const CART_L = 0.9;
const BUMPER = 0.14;
const BENCH_TOP = 0.0;
const loadFor = (m: number) => Math.max(0, Math.min(3, Math.round((m - 1) / 1.2)));

interface Prediction {
  v1: number;
  v2: number;
}
function predictAfter(m1: number, v1: number, m2: number, v2: number, elastic: boolean): Prediction {
  if (elastic) {
    const v1a = ((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2);
    const v2a = ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2);
    return { v1: v1a, v2: v2a };
  }
  const vCommon = (m1 * v1 + m2 * v2) / (m1 + m2);
  return { v1: vCommon, v2: vCommon };
}

interface SamplePoint {
  t: number;
  v1: number;
  v2: number;
  p1: number;
  p2: number;
  pTotal: number;
  [key: string]: number;
}

interface LiveNumbers {
  t: number;
  x1: number;
  x2: number;
  v1: number;
  v2: number;
  collided: boolean;
}

function PhysicsDriver({
  running,
  speed,
  onFixedStep,
}: {
  running: boolean;
  speed: number;
  onFixedStep: (dt: number) => void;
}) {
  const { step } = useRapier();
  return (
    <PhysicsTicker
      running={running}
      speed={speed}
      fixedDt={1 / 120}
      onFixedStep={(dt) => {
        step(dt);
        onFixedStep(dt);
      }}
    />
  );
}

interface SceneContentProps {
  m1: number;
  v1_0: number;
  m2: number;
  v2_0: number;
  elastic: boolean;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onCollided: () => void;
  onFinished: () => void;
}

function SceneContent({ m1, v1_0, m2, v2_0, elastic, running, speed, onSample, onLive, onCollided, onFinished }: SceneContentProps) {
  const body1 = useRef<RapierRigidBody>(null);
  const body2 = useRef<RapierRigidBody>(null);
  const vArrow1 = useRef<VectorArrowHandle>(null);
  const vArrow2 = useRef<VectorArrowHandle>(null);

  const collidedRef = useRef(false);
  const collidedAtRef = useRef(0);
  const finishedRef = useRef(false);
  const simTimeRef = useRef(0);

  const handleCollisionEnter = useCallback(() => {
    if (!collidedRef.current) {
      collidedRef.current = true;
      collidedAtRef.current = simTimeRef.current;
      onCollided();
    }
  }, [onCollided]);

  const restitution = elastic ? 1 : 0;

  const handleFixedStep = useCallback(
    (dt: number) => {
      simTimeRef.current += dt;
      const t = simTimeRef.current;
      const b1 = body1.current;
      const b2 = body2.current;
      if (!b1 || !b2) return;

      const lv1 = b1.linvel();
      const lv2 = b2.linvel();
      const p1 = b1.translation();
      const p2 = b2.translation();

      vArrow1.current?.set([p1.x, BENCH_TOP + 1.3, 0], [lv1.x * V_SCALE, 0, 0]);
      vArrow2.current?.set([p2.x, BENCH_TOP + 1.3, 0], [lv2.x * V_SCALE, 0, 0]);

      const outOfBounds = Math.abs(p1.x) > RAIL_HALF + 1 || Math.abs(p2.x) > RAIL_HALF + 1;
      const doneHolding = collidedRef.current && t - collidedAtRef.current > POST_COLLISION_HOLD;
      if (!finishedRef.current && (outOfBounds || doneHolding || t > MAX_TIME)) {
        finishedRef.current = true;
        onFinished();
      }
    },
    [onFinished],
  );

  return (
    <>
      <PhysicsDriver running={running} speed={speed} onFixedStep={handleFixedStep} />
      <PhysicsTicker
        running={running}
        speed={speed}
        sampleHz={20}
        onSample={() => {
          const b1 = body1.current;
          const b2 = body2.current;
          if (!b1 || !b2) return;
          const v1 = b1.linvel().x;
          const v2 = b2.linvel().x;
          onSample({ t: simTimeRef.current, v1, v2, p1: m1 * v1, p2: m2 * v2, pTotal: m1 * v1 + m2 * v2 });
          onLive({ t: simTimeRef.current, x1: b1.translation().x, x2: b2.translation().x, v1, v2, collided: collidedRef.current });
        }}
      />

      {/* lab bench with an aluminium track */}
      <Ground kind="tiles" from={-12} to={12} width={12} tile={3} tileZ={3} y={-1.01} />
      <LabBench position={[0, -1, 0]} length={RAIL_HALF * 2 + 2} depth={1.6} height={1} />
      <mesh position={[0, BENCH_TOP + 0.015, 0]} receiveShadow>
        <boxGeometry args={[RAIL_HALF * 2 + 1.5, 0.03, 0.62]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.35} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (RAIL_HALF + 0.75), BENCH_TOP + 0.12, 0]}>
          <boxGeometry args={[0.06, 0.22, 0.62]} />
          <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      <RigidBody
        ref={body1}
        type="dynamic"
        colliders={false}
        linearDamping={0}
        angularDamping={0}
        enabledTranslations={[true, false, false]}
        enabledRotations={[false, false, false]}
        position={[X1_0, RAIL_Y, 0]}
        linearVelocity={[v1_0, 0, 0]}
        onCollisionEnter={handleCollisionEnter}
      >
        <CuboidCollider args={[CART_L / 2 + BUMPER, 0.15, 0.25]} position={[0, 0.1, 0]} mass={m1} restitution={restitution} friction={0} />
        <group position={[0, -RAIL_Y + BENCH_TOP + 0.03, 0]}>
          <LabCart length={CART_L} color={COLOR1} tag="1" load={loadFor(m1)} bumper={elastic ? "spring" : "clay"} />
          <SceneLabel position={[0, 1.0, 0]} tone={COLOR1}>{`тележка 1, ${m1} кг`}</SceneLabel>
        </group>
      </RigidBody>

      <RigidBody
        ref={body2}
        type="dynamic"
        colliders={false}
        linearDamping={0}
        angularDamping={0}
        enabledTranslations={[true, false, false]}
        enabledRotations={[false, false, false]}
        position={[X2_0, RAIL_Y, 0]}
        linearVelocity={[v2_0, 0, 0]}
      >
        <CuboidCollider args={[CART_L / 2 + BUMPER, 0.15, 0.25]} position={[0, 0.1, 0]} mass={m2} restitution={restitution} friction={0} />
        <group position={[0, -RAIL_Y + BENCH_TOP + 0.03, 0]}>
          <LabCart length={CART_L} color={COLOR2} tag="2" load={loadFor(m2)} backBumper={elastic ? "spring" : "clay"} />
          <SceneLabel position={[0, 1.0, 0]} tone={COLOR2}>{`тележка 2, ${m2} кг`}</SceneLabel>
        </group>
      </RigidBody>

      <VectorArrow ref={vArrow1} color="#4ade80" />
      <VectorArrow ref={vArrow2} color="#4ade80" />
    </>
  );
}

/* ---------------- Newton's cradle (analytic, ideal elastic chain) ---------------- */

const CRADLE_N = 5;
const CRADLE_R = 0.2;
const CRADLE_L = 1.6;
const CRADLE_PIVOT_Y = 2.35;
const CRADLE_HALF_DEPTH = 0.45;

interface CradleLive {
  t: number;
  vFirst: number;
  vLast: number;
  side: "left" | "right";
}

function SceneCradle({
  thetaDeg,
  lifted,
  running,
  speed,
  onLive,
}: {
  thetaDeg: number;
  lifted: number;
  running: boolean;
  speed: number;
  onLive: (n: CradleLive) => void;
}) {
  const balls = useRef<(THREE.Group | null)[]>([]);
  const strings = useRef<(RodHandle | null)[]>([]);
  const vArrow = useRef<VectorArrowHandle>(null);
  const theta0 = THREE.MathUtils.degToRad(thetaDeg);
  const omega = Math.sqrt(9.8 / CRADLE_L);
  const T = (2 * Math.PI) / omega;
  const vImpact = Math.sqrt(2 * 9.8 * CRADLE_L * (1 - Math.cos(theta0)));
  const xs = useMemo(() => Array.from({ length: CRADLE_N }, (_, i) => (i - (CRADLE_N - 1) / 2) * 2 * CRADLE_R), []);

  /** swing angle of each ball: the left group falls first (quarter period), then the sides alternate every half period */
  const anglesAt = useCallback(
    (t: number) => {
      const out = new Array(CRADLE_N).fill(0);
      let side: "left" | "right" = "left";
      let ang = 0;
      if (t < T / 4) {
        ang = -theta0 * Math.cos(omega * t);
        side = "left";
      } else {
        const k = Math.floor((t - T / 4) / (T / 2));
        const tau = t - T / 4 - k * (T / 2);
        side = k % 2 === 0 ? "right" : "left";
        ang = (side === "right" ? 1 : -1) * theta0 * Math.sin(omega * tau);
      }
      for (let i = 0; i < CRADLE_N; i++) {
        if (side === "left" && i < lifted) out[i] = ang;
        if (side === "right" && i >= CRADLE_N - lifted) out[i] = ang;
      }
      const v = vImpact * (side === "left" && t < T / 4 ? Math.sin(omega * t) : Math.abs(Math.cos(omega * ((t - T / 4) % (T / 2)))));
      return { out, side, v };
    },
    [T, theta0, omega, lifted, vImpact],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const { out, side } = anglesAt(t);
      out.forEach((a, i) => {
        const bx = xs[i] + CRADLE_L * Math.sin(a);
        const by = CRADLE_PIVOT_Y - CRADLE_L * Math.cos(a);
        balls.current[i]?.position.set(bx, by, 0);
        strings.current[2 * i]?.set([xs[i], CRADLE_PIVOT_Y, -CRADLE_HALF_DEPTH], [bx, by + CRADLE_R * 0.8, 0]);
        strings.current[2 * i + 1]?.set([xs[i], CRADLE_PIVOT_Y, CRADLE_HALF_DEPTH], [bx, by + CRADLE_R * 0.8, 0]);
      });
      // velocity of the moving outer ball
      const idx = side === "left" ? 0 : CRADLE_N - 1;
      const a = out[idx];
      const dt = 1 / 240;
      const a2 = anglesAt(t + dt).out[idx];
      const w = (a2 - a) / dt;
      const vx = CRADLE_L * w * Math.cos(a);
      const vy = CRADLE_L * w * Math.sin(a);
      const bx = xs[idx] + CRADLE_L * Math.sin(a);
      const by = CRADLE_PIVOT_Y - CRADLE_L * Math.cos(a);
      vArrow.current?.set([bx, by + CRADLE_R + 0.15, 0.3], [vx * 0.18, vy * 0.18, 0]);
    },
    [anglesAt, xs],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const { side, v } = anglesAt(t);
          onLive({ t, vFirst: side === "left" ? v : 0, vLast: side === "right" ? v : 0, side });
        }}
      />
      {/* wooden base and a polished metal frame */}
      <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.12, 1.4]} />
        <meshStandardMaterial map={woodTexture("dark", 3)} roughness={0.6} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.4, CRADLE_PIVOT_Y / 2 + 0.06, sz * CRADLE_HALF_DEPTH]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, CRADLE_PIVOT_Y, 10]} />
            <meshStandardMaterial color="#d4d4d8" metalness={1} roughness={0.15} />
          </mesh>
        )),
      )}
      {[-1, 1].map((sz) => (
        <mesh key={sz} position={[0, CRADLE_PIVOT_Y + 0.06, sz * CRADLE_HALF_DEPTH]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 2.86, 10]} />
          <meshStandardMaterial color="#d4d4d8" metalness={1} roughness={0.15} />
        </mesh>
      ))}
      {xs.map((x, i) => (
        <group key={i}>
          <Rod ref={(h) => { strings.current[2 * i] = h; }} radius={0.005} color="#e5e7eb" />
          <Rod ref={(h) => { strings.current[2 * i + 1] = h; }} radius={0.005} color="#e5e7eb" />
          <group ref={(g) => { balls.current[i] = g; }} position={[x, CRADLE_PIVOT_Y - CRADLE_L, 0]}>
            <SteelBall radius={CRADLE_R} />
          </group>
        </group>
      ))}
      <SceneLabel position={[xs[0] - 0.9, 0.5, 0.8]}>{lifted === 1 ? "отводим 1 шар" : `отводим ${lifted} шара`}</SceneLabel>
      <VectorArrow ref={vArrow} color="#4ade80" />
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1.5 text-left font-medium text-muted-2">{children}</th>;
}
function Td({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td className={cn("px-2 py-1.5 font-mono tabular-nums", className)} style={style}>
      {children}
    </td>
  );
}

export function CollisionsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, m1, v1_0, m2, v2_0, mode, thetaCradle, lifted } = useControls("Столкновение", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Тележки на рельсах": "abstract", "Колыбель Ньютона": "cradle" },
    },
    m1: { value: 2, min: 0.5, max: 5, step: 0.1, label: "m₁, кг", render: (get) => get("Столкновение.scenario") === "abstract" },
    v1_0: { value: 4, min: -6, max: 6, step: 0.5, label: "v₁₀, м/с", render: (get) => get("Столкновение.scenario") === "abstract" },
    m2: { value: 3, min: 0.5, max: 5, step: 0.1, label: "m₂, кг", render: (get) => get("Столкновение.scenario") === "abstract" },
    v2_0: { value: -2, min: -6, max: 6, step: 0.5, label: "v₂₀, м/с", render: (get) => get("Столкновение.scenario") === "abstract" },
    mode: {
      value: "elastic",
      options: { "Упругое": "elastic", "Неупругое": "inelastic" },
      label: "Тип удара",
      render: (get) => get("Столкновение.scenario") === "abstract",
    },
    thetaCradle: { value: 30, min: 10, max: 50, step: 1, label: "угол отклонения, °", render: (get) => get("Столкновение.scenario") === "cradle" },
    lifted: { value: 1, min: 1, max: 3, step: 1, label: "сколько шаров отвести", render: (get) => get("Столкновение.scenario") === "cradle" },
  });
  const vCradle = Math.sqrt(2 * 9.8 * CRADLE_L * (1 - Math.cos((thetaCradle * Math.PI) / 180)));
  const elastic = mode === "elastic";
  const cradle = scenario === "cradle";

  const initialLive: LiveNumbers = { t: 0, x1: X1_0, x2: X2_0, v1: v1_0, v2: v2_0, collided: false };
  const [live, setLive] = useState<LiveNumbers>(initialLive);
  const [series, setSeries] = useState<SamplePoint[]>([
    { t: 0, v1: v1_0, v2: v2_0, p1: m1 * v1_0, p2: m2 * v2_0, pTotal: m1 * v1_0 + m2 * v2_0 },
  ]);
  const [collided, setCollided] = useState(false);

  const prediction = useMemo(() => predictAfter(m1, v1_0, m2, v2_0, elastic), [m1, v1_0, m2, v2_0, elastic]);

  const p1_0 = m1 * v1_0;
  const p2_0 = m2 * v2_0;
  const e1_0 = 0.5 * m1 * v1_0 * v1_0;
  const e2_0 = 0.5 * m2 * v2_0 * v2_0;
  const p1_a = m1 * prediction.v1;
  const p2_a = m2 * prediction.v2;
  const e1_a = 0.5 * m1 * prediction.v1 * prediction.v1;
  const e2_a = 0.5 * m2 * prediction.v2 * prediction.v2;

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 600 ? prev : [...prev, p]));
  }, []);

  const handleFinished = useCallback(() => clock.pause(), [clock]);
  const handleCollided = useCallback(() => setCollided(true), []);

  const [cradleLive, setCradleLive] = useState<CradleLive>({ t: 0, vFirst: 0, vLast: 0, side: "left" });

  const runKey = `${clock.resetNonce}|${scenario}|${m1}|${v1_0}|${m2}|${v2_0}|${mode}|${thetaCradle}|${lifted}`;
  const play = clock.play;
  useEffect(() => {
    setLive({ t: 0, x1: X1_0, x2: X2_0, v1: v1_0, v2: v2_0, collided: false });
    setSeries([{ t: 0, v1: v1_0, v2: v2_0, p1: m1 * v1_0, p2: m2 * v2_0, pTotal: m1 * v1_0 + m2 * v2_0 }]);
    setCollided(false);
    setCradleLive({ t: 0, vFirst: 0, vLast: 0, side: "left" });
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const approaching = v1_0 - v2_0 > 0;
  let caption;
  let legend: LegendItem[];
  if (cradle) {
    caption = (
      <>
        {lifted === 1 ? "Отвели один шар" : `Отвели ${lifted} шара`} на {thetaCradle}° и отпустили. При ударе импульс и энергия пробегают по цепочке — с другой стороны
        вылетает <b>ровно столько же шаров ({lifted})</b> с той же скоростью {vCradle.toFixed(1).replace(".", ",")} м/с, а средние почти не двигаются.
      </>
    );
    legend = [{ color: "#4ade80", label: "скорость крайнего шара" }];
  } else {
    caption = !approaching ? (
      <>Тележки не догоняют друг друга — столкновения не будет. Сделайте скорость первой больше, чем у второй.</>
    ) : !collided ? (
      <>
        Тележки сближаются. До удара суммарный импульс Σp = {(p1_0 + p2_0).toFixed(1)} кг·м/с — посмотрим, сохранится ли он.{" "}
        {elastic ? "Бамперы — стальные пружины (упругий удар)." : "На бамперах пластилин — тележки слипнутся (неупругий удар)."}
      </>
    ) : elastic ? (
      <>
        <b>Упругий удар:</b> пружины сжались и распрямились, тележки разъехались. Σp = {(m1 * live.v1 + m2 * live.v2).toFixed(1)} кг·м/с — как и до удара; кинетическая
        энергия тоже сохранилась.
      </>
    ) : (
      <>
        <b>Неупругий удар:</b> пластилин склеил тележки, дальше они едут вместе со скоростью {live.v1.toFixed(2)} м/с. Импульс сохранился (Σp ={" "}
        {(m1 * live.v1 + m2 * live.v2).toFixed(1)}), а часть энергии ушла на смятие пластилина.
      </>
    );
    legend = [
      { color: "#4ade80", label: "скорость v" },
      { color: COLOR1, label: "тележка 1", kind: "square" },
      { color: COLOR2, label: "тележка 2", kind: "square" },
    ];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={cradle ? { position: [0.4, 2.2, 5.6], fov: 45 } : { position: [-0.8, 1.9, 7.2], fov: 50 }}
          orbitTarget={cradle ? [0, 1.25, 0] : [-0.8, 0.25, 0]}
          simplified={isMobile}
          maxDistance={30}
          minDistance={2}
          contactShadows={false}
          bloomThreshold={0.6}
          fogRange={[14, 40]}
        >
          {cradle ? (
            <SceneCradle key={runKey} thetaDeg={thetaCradle} lifted={lifted} running={clock.running} speed={clock.speed} onLive={setCradleLive} />
          ) : (
            <Physics gravity={[0, 0, 0]} paused>
              <SceneContent
                key={runKey}
                m1={m1}
                v1_0={v1_0}
                m2={m2}
                v2_0={v2_0}
                elastic={elastic}
                running={clock.running}
                speed={clock.speed}
                onSample={handleSample}
                onLive={setLive}
                onCollided={handleCollided}
                onFinished={handleFinished}
              />
            </Physics>
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls
          running={clock.running}
          onToggle={clock.toggle}
          onReset={handleReset}
          speed={clock.speed}
          onSpeedChange={clock.setSpeed}
        />
      }
      numbers={
        cradle ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: cradleLive.t.toFixed(2), unit: "с" },
              { label: "Скорость удара", value: vCradle.toFixed(2), unit: "м/с" },
              { label: "v левого шара", value: cradleLive.vFirst.toFixed(2), unit: "м/с", color: "#4ade80" },
              { label: "v правого шара", value: cradleLive.vLast.toFixed(2), unit: "м/с", color: "#4ade80" },
              { label: "Сейчас качается", value: cradleLive.side === "left" ? "слева" : "справа" },
            ]}
          />
        ) : (
        <div className="flex flex-col gap-3">
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "v₁", value: live.v1.toFixed(2), unit: "м/с", color: COLOR1 },
              { label: "v₂", value: live.v2.toFixed(2), unit: "м/с", color: COLOR2 },
              { label: "Столкновение", value: live.collided ? "было" : "ещё нет" },
            ]}
          />
          <div role="region" aria-label="Результаты столкновения" tabIndex={0} className="overflow-x-auto rounded-xl border border-border bg-surface-2/60 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Импульс и энергия</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <Th>Величина</Th>
                  <Th>До удара</Th>
                  <Th>После (прогноз)</Th>
                  <Th>После (симуляция)</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/60">
                  <Td className="text-muted">p₁, кг·м/с</Td>
                  <Td>{p1_0.toFixed(2)}</Td>
                  <Td>{p1_a.toFixed(2)}</Td>
                  <Td style={{ color: COLOR1 }}>{collided ? (m1 * live.v1).toFixed(2) : "—"}</Td>
                </tr>
                <tr className="border-b border-border/60">
                  <Td className="text-muted">p₂, кг·м/с</Td>
                  <Td>{p2_0.toFixed(2)}</Td>
                  <Td>{p2_a.toFixed(2)}</Td>
                  <Td style={{ color: COLOR2 }}>{collided ? (m2 * live.v2).toFixed(2) : "—"}</Td>
                </tr>
                <tr className="border-b border-border/60">
                  <Td className="text-muted">Σp, кг·м/с</Td>
                  <Td>{(p1_0 + p2_0).toFixed(2)}</Td>
                  <Td>{(p1_a + p2_a).toFixed(2)}</Td>
                  <Td>{collided ? (m1 * live.v1 + m2 * live.v2).toFixed(2) : "—"}</Td>
                </tr>
                <tr className="border-b border-border/60">
                  <Td className="text-muted">E₁, Дж</Td>
                  <Td>{e1_0.toFixed(2)}</Td>
                  <Td>{e1_a.toFixed(2)}</Td>
                  <Td style={{ color: COLOR1 }}>{collided ? (0.5 * m1 * live.v1 * live.v1).toFixed(2) : "—"}</Td>
                </tr>
                <tr className="border-b border-border/60">
                  <Td className="text-muted">E₂, Дж</Td>
                  <Td>{e2_0.toFixed(2)}</Td>
                  <Td>{e2_a.toFixed(2)}</Td>
                  <Td style={{ color: COLOR2 }}>{collided ? (0.5 * m2 * live.v2 * live.v2).toFixed(2) : "—"}</Td>
                </tr>
                <tr>
                  <Td className="text-muted">ΣE, Дж</Td>
                  <Td>{(e1_0 + e2_0).toFixed(2)}</Td>
                  <Td>{(e1_a + e2_a).toFixed(2)}</Td>
                  <Td>{collided ? (0.5 * m1 * live.v1 * live.v1 + 0.5 * m2 * live.v2 * live.v2).toFixed(2) : "—"}</Td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        )
      }
      graphs={
        cradle ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Почему вылетает столько же шаров? Одновременно должны сохраниться и импульс (m·v), и энергия (m·v²/2). Если бы
            вылетел один шар со скоростью 2v вместо двух со скоростью v, импульс сохранился бы, а энергия выросла бы вдвое — так
            не бывает.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">v(t) — скорости</p>
              <LiveChart
                data={series}
                xKey="t"
                xLabel="t, с"
                series={[
                  { key: "v1", color: COLOR1, label: "v₁" },
                  { key: "v2", color: COLOR2, label: "v₂" },
                ]}
              />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">p(t) — импульс (Σp сохраняется)</p>
              <LiveChart
                data={series}
                xKey="t"
                xLabel="t, с"
                series={[
                  { key: "p1", color: COLOR1, label: "p₁" },
                  { key: "p2", color: COLOR2, label: "p₂" },
                  { key: "pTotal", color: "#f4f4f5", label: "Σp" },
                ]}
              />
            </div>
          </div>
        )
      }
      note={
        cradle ? (
          <>
            Колыбель Ньютона: пять одинаковых стальных шаров на нитях. Для двух равных масс упругий удар полностью меняет их
            скорости местами (v₁′ = v₂, v₂′ = v₁) — поэтому импульс передаётся по цепочке от шара к шару, и в движение приходит
            только крайний шар с той же скоростью. Потери энергии здесь не учитываются, поэтому качание не затухает.
          </>
        ) : (
          <>
            Столкновение тележек моделируется физическим движком Rapier (контакт двух тел на рельсе без трения):
            restitution = 1 при упругом ударе (пружинные бамперы), 0 — при неупругом (пластилин). Формулы v₁′, v₂′
            используются только для независимой проверки (столбец «прогноз»).
          </>
        )
      }
    />
  );
}
