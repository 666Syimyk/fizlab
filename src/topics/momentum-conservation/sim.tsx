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
import { Bullet, Cannon, CANNON_PIVOT_Y, Rifle, Rod, WoodenCrate, type RodHandle } from "@/components/sim/props/mechanics";
import { Cannonball } from "@/components/sim/props/sport";
import { Person } from "@/components/sim/props/Person";
import { pose, PUSH, type PoseAngles } from "@/components/sim/props/pose";
import { Ground } from "@/components/sim/props/environment";
import { tapeTexture, woodTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const BOUND = 8;
const V_SCALE = 0.25;
const P_COLOR = "#c084fc";
const G = 9.8;
const FLIGHT_T = 0.18;
const PIVOT = new THREE.Vector3(0, 3.3, 0);
const BULLET_START_X = -4.6;
const CANNON_MUZZLE_X = 1.2;

interface ExplosionSample {
  t: number;
  p1: number;
  p2: number;
  pTotal: number;
  [key: string]: number;
}
interface ExplosionLive {
  t: number;
  x1: number;
  x2: number;
  v1: number;
  v2: number;
}

interface PendulumSample {
  t: number;
  thetaDeg: number;
  [key: string]: number;
}
interface PendulumLive {
  t: number;
  phase: "flight" | "swing" | "measured";
  thetaDeg: number;
  hCm: number;
  vAfter: number;
  vMeasured: number;
}

/* ---------------- cannon recoil / two skaters ---------------- */

interface SceneExplosionProps {
  style: "cannon" | "skaters";
  M: number;
  m: number;
  vBall: number;
  running: boolean;
  speed: number;
  onSample: (p: ExplosionSample) => void;
  onLive: (n: ExplosionLive) => void;
  onFinished: () => void;
}

function SceneExplosion({ style, M, m, vBall, running, speed, onSample, onLive, onFinished }: SceneExplosionProps) {
  const vCannon = -(m * vBall) / M;
  const heavyRef = useRef<THREE.Group>(null!);
  const lightRef = useRef<THREE.Group>(null!);
  const smoke = useRef<THREE.Group>(null!);
  const wheelSpin = useRef(0);
  const vHeavyArrow = useRef<VectorArrowHandle>(null);
  const vLightArrow = useRef<VectorArrowHandle>(null);
  const pHeavyArrow = useRef<VectorArrowHandle>(null);
  const pLightArrow = useRef<VectorArrowHandle>(null);
  const heavyPose = useRef<PoseAngles>(PUSH);
  const lightPose = useRef<PoseAngles>(PUSH);
  const finishedRef = useRef(false);
  const cannon = style === "cannon";

  // the light body starts at the muzzle (cannon) or at arm's length from the adult (skaters)
  const lightStart = cannon ? CANNON_MUZZLE_X : 0.42;
  const heavyStart = cannon ? 0 : -0.42;
  const glide = useMemo(() => pose({ spreadL: 0.55, spreadR: 0.55, shoulderL: 0.25, shoulderR: 0.25, elbowL: 0.3, elbowR: 0.3, hipL: 0.15, kneeL: 0.2, hipR: -0.1 }), []);
  const pScale = 0.09 / Math.max(1, (m * Math.abs(vBall)) / 12);

  const handleFrame = useCallback(
    (t: number) => {
      const x1 = heavyStart + vCannon * t;
      const x2 = lightStart + vBall * t;
      if (heavyRef.current) heavyRef.current.position.x = x1;
      if (lightRef.current) lightRef.current.position.x = x2;
      wheelSpin.current = (vCannon * t) / 0.5;
      const h1 = cannon ? 1.9 : 2.2;
      const h2 = cannon ? 0.9 : 1.75;
      vHeavyArrow.current?.set([x1, h1, 0], [vCannon * V_SCALE, 0, 0]);
      vLightArrow.current?.set([x2, h2, 0], [vBall * V_SCALE, 0, 0]);
      pHeavyArrow.current?.set([x1, h1 + 0.45, 0], [M * vCannon * pScale, 0, 0]);
      pLightArrow.current?.set([x2, h2 + 0.45, 0], [m * vBall * pScale, 0, 0]);
      if (!cannon) {
        const pushing = t < 0.3;
        heavyPose.current = pushing ? PUSH : glide;
        lightPose.current = pushing ? PUSH : glide;
      }
      if (smoke.current) {
        const show = cannon && t < 1;
        smoke.current.visible = show;
        if (show) {
          smoke.current.scale.setScalar(0.3 + t * 2.2);
          smoke.current.children.forEach((child) => {
            ((child as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - t);
          });
        }
      }
      if (!finishedRef.current && (Math.abs(x1) > BOUND || Math.abs(x2) > BOUND)) {
        finishedRef.current = true;
        onLive({ t, x1, x2, v1: vCannon, v2: vBall });
        onFinished();
      }
    },
    [vBall, vCannon, heavyStart, lightStart, cannon, M, m, pScale, glide, onLive, onFinished],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          onSample({ t, p1: M * vCannon, p2: m * vBall, pTotal: M * vCannon + m * vBall });
          onLive({ t, x1: heavyStart + vCannon * t, x2: lightStart + vBall * t, v1: vCannon, v2: vBall });
        }}
      />

      {cannon ? (
        <>
          <Ground kind="grass" from={-14} to={14} width={14} tile={5} tileZ={5} y={-0.01} />
          <group ref={heavyRef} position={[heavyStart, 0, 0]}>
            <Cannon elevationDeg={0} spinRef={wheelSpin} />
            <SceneLabel position={[-0.3, 1.45, 0]}>{`пушка, M = ${M} кг`}</SceneLabel>
          </group>
          <group ref={lightRef} position={[lightStart, CANNON_PIVOT_Y, 0]}>
            <Cannonball radius={0.13} />
            <SceneLabel position={[0, 0.45, 0]}>{`ядро, m = ${m} кг`}</SceneLabel>
          </group>
          <group ref={smoke} position={[CANNON_MUZZLE_X + 0.2, CANNON_PIVOT_Y, 0]}>
            {[
              [0, 0, 0, 0.35],
              [0.3, 0.12, 0.08, 0.28],
              [0.15, 0.3, -0.12, 0.24],
            ].map(([x, y, z, r], i) => (
              <mesh key={i} position={[x, y, z]}>
                <sphereGeometry args={[r, 12, 10]} />
                <meshStandardMaterial color="#d4d4d8" transparent opacity={0.5} depthWrite={false} roughness={1} />
              </mesh>
            ))}
          </group>
        </>
      ) : (
        <>
          <Ground kind="ice" from={-14} to={14} width={12} tile={10} tileZ={12} y={-0.01} />
          {/* rink boards */}
          <mesh position={[0, 0.55, -5]} receiveShadow>
            <boxGeometry args={[28, 1.1, 0.12]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.12, -5]}>
            <boxGeometry args={[28, 0.06, 0.16]} />
            <meshStandardMaterial color="#1d4ed8" roughness={0.4} />
          </mesh>
          <group ref={heavyRef} position={[heavyStart, 0.1, 0]}>
            <Person rotation={[0, Math.PI / 2, 0]} scale={1.05} poseRef={heavyPose} skates shirt="#2563eb" pants="#111827" />
            <SceneLabel position={[0, 2.75, 0]}>{`взрослый, ${M} кг`}</SceneLabel>
          </group>
          <group ref={lightRef} position={[lightStart, 0.1, 0]}>
            <Person rotation={[0, -Math.PI / 2, 0]} scale={0.72} poseRef={lightPose} skates shirt="#f97316" pants="#6b21a8" longHair hair="#b45309" />
            <SceneLabel position={[0, 2.3, 0]}>{`ребёнок, ${m} кг`}</SceneLabel>
          </group>
        </>
      )}

      <VectorArrow ref={vHeavyArrow} color="#4ade80" />
      <VectorArrow ref={vLightArrow} color="#4ade80" />
      <VectorArrow ref={pHeavyArrow} color={P_COLOR} shaftRadius={0.06} headRadius={0.15} headLength={0.3} />
      <VectorArrow ref={pLightArrow} color={P_COLOR} shaftRadius={0.06} headRadius={0.15} headLength={0.3} />
    </>
  );
}

/* ---------------- ballistic pendulum ---------------- */

interface ScenePendulumProps {
  mBullet: number;
  vBullet: number;
  MBlock: number;
  Lstring: number;
  running: boolean;
  speed: number;
  onSample: (p: PendulumSample) => void;
  onLive: (n: PendulumLive) => void;
  onFinished: () => void;
}

function ScenePendulum({ mBullet, vBullet, MBlock, Lstring, running, speed, onSample, onLive, onFinished }: ScenePendulumProps) {
  const vAfter = (mBullet * vBullet) / (mBullet + MBlock);
  const hMax = Math.min((vAfter * vAfter) / (2 * G), 1.85 * Lstring);
  const thetaMax = Math.acos(THREE.MathUtils.clamp(1 - hMax / Lstring, -1, 1));
  const omega = Math.sqrt(G / Lstring);
  const quarterPeriod = Math.PI / 2 / omega;
  const blockH = 0.34 + 0.06 * Math.cbrt(MBlock);
  const blockW = 0.55 + 0.1 * Math.cbrt(MBlock);
  const attachY = PIVOT.y - Lstring;
  const restY = attachY - blockH / 2;
  const SPREAD = 0.22;

  const bulletRef = useRef<THREE.Group>(null!);
  const blockRef = useRef<THREE.Group>(null!);
  const marker = useRef<THREE.Mesh>(null!);
  const strings = [useRef<RodHandle>(null), useRef<RodHandle>(null)];
  const finishedRef = useRef(false);
  const [embedded, setEmbedded] = useState(false);
  const embeddedRef = useRef(false);
  const wood = woodTexture("medium", 3);
  const tape = useMemo(() => tapeTexture(0, 1, 1), []);

  const handleFrame = useCallback(
    (t: number) => {
      let theta = 0;
      if (t < FLIGHT_T) {
        const bx = THREE.MathUtils.lerp(BULLET_START_X, -blockW / 2, t / FLIGHT_T);
        if (bulletRef.current) {
          bulletRef.current.visible = true;
          bulletRef.current.position.set(bx, restY, 0);
        }
      } else {
        if (bulletRef.current) bulletRef.current.visible = false;
        if (!embeddedRef.current) {
          embeddedRef.current = true;
          setEmbedded(true);
        }
        const tt = t - FLIGHT_T;
        if (tt >= quarterPeriod) {
          theta = thetaMax;
          if (!finishedRef.current) {
            finishedRef.current = true;
            onLive({ t, phase: "measured", thetaDeg: (theta * 180) / Math.PI, hCm: hMax * 100, vAfter, vMeasured: ((MBlock + mBullet) / mBullet) * Math.sqrt(2 * G * hMax) });
            onFinished();
          }
        } else theta = thetaMax * Math.sin(omega * tt);
      }
      // parallel strings: the block translates along an arc without tilting
      const dx = Lstring * Math.sin(theta);
      const dy = Lstring * (1 - Math.cos(theta));
      if (blockRef.current) blockRef.current.position.set(dx, restY + dy, 0);
      [-1, 1].forEach((s, i) => strings[i].current?.set([s * SPREAD, PIVOT.y, 0], [dx + s * SPREAD, attachY + dy, 0]));
      if (marker.current) marker.current.position.y = Math.max(marker.current.position.y, restY + blockH / 2 + dy);
    },
    // strings are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thetaMax, omega, quarterPeriod, Lstring, restY, attachY, blockW, blockH, hMax, vAfter, MBlock, mBullet, onLive, onFinished],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const tt = Math.max(0, t - FLIGHT_T);
          const capped = Math.min(tt, quarterPeriod);
          const theta = t < FLIGHT_T ? 0 : thetaMax * Math.sin(omega * capped);
          const measured = t >= FLIGHT_T + quarterPeriod;
          onSample({ t, thetaDeg: (theta * 180) / Math.PI });
          onLive({
            t,
            phase: t < FLIGHT_T ? "flight" : measured ? "measured" : "swing",
            thetaDeg: (theta * 180) / Math.PI,
            hCm: (measured ? hMax : Lstring * (1 - Math.cos(theta))) * 100,
            vAfter,
            vMeasured: measured ? ((MBlock + mBullet) / mBullet) * Math.sqrt(2 * G * hMax) : 0,
          });
        }}
      />

      <Ground kind="tiles" from={-10} to={6} width={8} tile={2} tileZ={2} y={-0.01} />
      {/* wooden frame the pendulum hangs from */}
      <mesh position={[0, PIVOT.y + 0.08, 0]} castShadow>
        <boxGeometry args={[1.4, 0.16, 0.22]} />
        <meshStandardMaterial map={wood} roughness={0.8} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, PIVOT.y / 2, -0.5]} castShadow>
          <boxGeometry args={[0.12, PIVOT.y + 0.3, 0.12]} />
          <meshStandardMaterial map={wood} roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[0, PIVOT.y + 0.08, -0.28]}>
        <boxGeometry args={[1.5, 0.12, 0.5]} />
        <meshStandardMaterial map={wood} roughness={0.8} />
      </mesh>
      {/* vertical tape to read the rise height */}
      <mesh position={[2.0, restY + blockH / 2 + 0.5, -0.1]} rotation={[0, 0, Math.PI / 2]}>
        <planeGeometry args={[1, 0.12]} />
        <meshStandardMaterial map={tape} roughness={0.7} />
      </mesh>
      <mesh ref={marker} position={[2.0, restY + blockH / 2, -0.08]}>
        <boxGeometry args={[0.2, 0.012, 0.02]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} />
      </mesh>
      <SceneLabel position={[2.0, restY + blockH / 2 + 1.2, 0]}>линейка: высота подъёма h</SceneLabel>

      <Rod ref={strings[0]} radius={0.012} color="#d6c08f" />
      <Rod ref={strings[1]} radius={0.012} color="#d6c08f" />
      <group ref={blockRef} position={[0, restY, 0]}>
        <WoodenCrate size={[blockW, blockH, 0.42]} tone="medium" frame={false} />
        {embedded && (
          <mesh position={[-blockW / 2 - 0.001, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <circleGeometry args={[0.025, 12]} />
            <meshBasicMaterial color="#1c1917" />
          </mesh>
        )}
        <SceneLabel position={[0, blockH / 2 + 0.3, 0]}>{`брусок, ${MBlock} кг`}</SceneLabel>
      </group>
      <group ref={bulletRef} position={[BULLET_START_X, restY, 0]}>
        <Bullet length={0.12} />
        <SceneLabel position={[0, 0.25, 0]} visible={!embedded}>
          пуля (увеличена)
        </SceneLabel>
      </group>
      <Rifle position={[BULLET_START_X, restY, 0]} />
    </>
  );
}

function stageForScenario(scenario: string) {
  if (scenario === "pendulum") {
    return { camera: { position: [-1.4, 2.6, 9.2] as [number, number, number], fov: 50 }, orbitTarget: [-1.2, 1.8, 0] as [number, number, number] };
  }
  if (scenario === "skaters") {
    return { camera: { position: [0, 2.6, 9.5] as [number, number, number], fov: 50 }, orbitTarget: [0, 1, 0] as [number, number, number] };
  }
  return { camera: { position: [0.5, 2.6, 9] as [number, number, number], fov: 50 }, orbitTarget: [0.5, 0.8, 0] as [number, number, number] };
}

const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function MomentumConservationSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, M, m, vBall, mAdult, mChild, vChild, mBulletG, vBullet, MBlock, Lstring } = useControls("Импульс", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Выстрел из пушки (отдача)": "abstract", "Два конькобежца отталкиваются": "skaters", "Баллистический маятник (пуля и брусок)": "pendulum" },
    },
    M: { value: 20, min: 5, max: 30, step: 1, label: "M пушки, кг", render: (get) => get("Импульс.scenario") === "abstract" },
    m: { value: 1, min: 0.1, max: 3, step: 0.1, label: "m ядра, кг", render: (get) => get("Импульс.scenario") === "abstract" },
    vBall: { value: 10, min: 2, max: 15, step: 0.5, label: "v ядра, м/с", render: (get) => get("Импульс.scenario") === "abstract" },
    mAdult: { value: 70, min: 50, max: 100, step: 1, label: "m взрослого, кг", render: (get) => get("Импульс.scenario") === "skaters" },
    mChild: { value: 30, min: 20, max: 60, step: 1, label: "m ребёнка, кг", render: (get) => get("Импульс.scenario") === "skaters" },
    vChild: { value: 3, min: 0.5, max: 5, step: 0.1, label: "v ребёнка, м/с", render: (get) => get("Импульс.scenario") === "skaters" },
    mBulletG: { value: 15, min: 5, max: 20, step: 1, label: "m пули, г", render: (get) => get("Импульс.scenario") === "pendulum" },
    vBullet: { value: 350, min: 150, max: 450, step: 10, label: "v₀ пули, м/с", render: (get) => get("Импульс.scenario") === "pendulum" },
    MBlock: { value: 2.5, min: 1, max: 6, step: 0.1, label: "M бруска, кг", render: (get) => get("Импульс.scenario") === "pendulum" },
    Lstring: { value: 2, min: 1.2, max: 2.5, step: 0.1, label: "L подвеса, м", render: (get) => get("Импульс.scenario") === "pendulum" },
  });

  const skaters = scenario === "skaters";
  const heavyMass = skaters ? mAdult : M;
  const lightMass = skaters ? mChild : m;
  const lightVelocityInput = skaters ? vChild : vBall;
  const vHeavy = -(lightMass * lightVelocityInput) / heavyMass;

  const runKey = `${clock.resetNonce}|${scenario}|${heavyMass}|${lightMass}|${lightVelocityInput}|${mBulletG}|${vBullet}|${MBlock}|${Lstring}`;
  const [explosionLive, setExplosionLive] = useState<ExplosionLive>({ t: 0, x1: 0, x2: 0, v1: vHeavy, v2: lightVelocityInput });
  const [explosionSeries, setExplosionSeries] = useState<ExplosionSample[]>([]);
  const [pendulumLive, setPendulumLive] = useState<PendulumLive>({ t: 0, phase: "flight", thetaDeg: 0, hCm: 0, vAfter: 0, vMeasured: 0 });
  const [pendulumSeries, setPendulumSeries] = useState<PendulumSample[]>([]);

  const play = clock.play;
  useEffect(() => {
    setExplosionLive({ t: 0, x1: 0, x2: 0, v1: vHeavy, v2: lightVelocityInput });
    setExplosionSeries([{ t: 0, p1: heavyMass * vHeavy, p2: lightMass * lightVelocityInput, pTotal: 0 }]);
    setPendulumLive({ t: 0, phase: "flight", thetaDeg: 0, hCm: 0, vAfter: 0, vMeasured: 0 });
    setPendulumSeries([{ t: 0, thetaDeg: 0 }]);
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleExplosionSample = useCallback((p: ExplosionSample) => {
    setExplosionSeries((prev) => (prev.length > 500 ? prev : [...prev, p]));
  }, []);
  const handlePendulumSample = useCallback((p: PendulumSample) => {
    setPendulumSeries((prev) => (prev.length > 500 ? prev : [...prev, p]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const stage = stageForScenario(scenario);
  const pLight = lightMass * lightVelocityInput;

  let caption;
  let legend: LegendItem[];
  if (scenario === "pendulum") {
    const mKg = mBulletG / 1000;
    caption =
      pendulumLive.phase === "flight" ? (
        <><b>Выстрел.</b> Пуля массой {mBulletG} г летит к деревянному бруску со скоростью {vBullet} м/с. Её импульс p = m·v₀ = {f2(mKg * vBullet)} кг·м/с.</>
      ) : pendulumLive.phase === "swing" ? (
        <>
          <b>Пуля застряла в бруске</b> — неупругий удар. Весь импульс {f2(mKg * vBullet)} кг·м/с достался бруску с пулей, но он в {Math.round((MBlock + mKg) / mKg)} раз тяжелее
          пули, поэтому едет всего {f2(pendulumLive.vAfter)} м/с — и поднимается, как качели.
        </>
      ) : (
        <>
          <b>Брусок поднялся на h = {f1(pendulumLive.hCm)} см</b> (красная отметка на линейке). Отсюда v₀ = ((M+m)/m)·√(2gh) = <b>{pendulumLive.vMeasured.toFixed(0)} м/с</b> — так
          измеряют скорость пули без радара.
        </>
      );
    legend = [
      { color: "#ef4444", label: "отметка высоты подъёма", kind: "line" },
      { color: "#d6c08f", label: "нити подвеса", kind: "line" },
    ];
  } else {
    const pHeavy = Math.abs(heavyMass * vHeavy);
    caption =
      explosionLive.t < 0.06 ? (
        <>{skaters ? "Стоят на льду, прижав ладони друг к другу" : "Пушка заряжена, всё неподвижно"}: общий импульс Σp = 0.</>
      ) : (
        <>
          {skaters ? (
            <><b>Оттолкнулись!</b> Лёгкий ребёнок ({lightMass} кг) катится быстро — {f1(lightVelocityInput)} м/с, тяжёлый взрослый ({heavyMass} кг) — медленно, {f2(Math.abs(vHeavy))} м/с.</>
          ) : (
            <><b>Выстрел!</b> Ядро ({lightMass} кг) летит вперёд со скоростью {f1(lightVelocityInput)} м/с, пушка ({heavyMass} кг) откатывается назад — {f2(Math.abs(vHeavy))} м/с.</>
          )}{" "}
          Но <b style={{ color: P_COLOR }}>импульсы равны</b>: {lightMass}·{f1(lightVelocityInput)} = {heavyMass}·{f2(Math.abs(vHeavy))} ≈ {f1(pHeavy)} кг·м/с и направлены в разные стороны, Σp = 0.
        </>
      );
    legend = [
      { color: "#4ade80", label: "скорость v" },
      { color: P_COLOR, label: "импульс p = m·v" },
    ];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={stage.camera} orbitTarget={stage.orbitTarget} simplified={isMobile} minDistance={3} maxDistance={24} bloomThreshold={0.6} fogRange={[16, 45]}>
          {scenario === "pendulum" ? (
            <ScenePendulum
              key={runKey}
              mBullet={mBulletG / 1000}
              vBullet={vBullet}
              MBlock={MBlock}
              Lstring={Lstring}
              running={clock.running}
              speed={clock.speed}
              onSample={handlePendulumSample}
              onLive={setPendulumLive}
              onFinished={handleFinished}
            />
          ) : (
            <SceneExplosion
              key={runKey}
              style={skaters ? "skaters" : "cannon"}
              M={heavyMass}
              m={lightMass}
              vBall={lightVelocityInput}
              running={clock.running}
              speed={clock.speed}
              onSample={handleExplosionSample}
              onLive={setExplosionLive}
              onFinished={handleFinished}
            />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        scenario === "pendulum" ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: pendulumLive.t.toFixed(2), unit: "с" },
              {
                label: "Фаза",
                value: pendulumLive.phase === "flight" ? "полёт пули" : pendulumLive.phase === "swing" ? "качание" : "измерено",
              },
              { label: "v₀ пули (задано)", value: vBullet.toFixed(0), unit: "м/с", color: "#f87171" },
              { label: "v после удара", value: pendulumLive.vAfter.toFixed(2), unit: "м/с" },
              { label: "Высота подъёма h", value: pendulumLive.hCm.toFixed(1), unit: "см", color: "#5eead4" },
              { label: "Угол качания θ", value: pendulumLive.thetaDeg.toFixed(1), unit: "°" },
              {
                label: "v пули по маятнику",
                value: pendulumLive.phase === "measured" ? pendulumLive.vMeasured.toFixed(0) : "—",
                unit: "м/с",
                color: "#4ade80",
              },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: explosionLive.t.toFixed(2), unit: "с" },
              { label: skaters ? "v ребёнка" : "v ядра", value: explosionLive.v2.toFixed(2), unit: "м/с", color: "#4ade80" },
              {
                label: skaters ? "v взрослого (отдача)" : "v пушки (отдача)",
                value: explosionLive.v1.toFixed(3),
                unit: "м/с",
                color: "#4ade80",
              },
              { label: skaters ? "p ребёнка" : "p ядра", value: (lightMass * explosionLive.v2).toFixed(2), unit: "кг·м/с", color: P_COLOR },
              { label: skaters ? "p взрослого" : "p пушки", value: (heavyMass * explosionLive.v1).toFixed(2), unit: "кг·м/с", color: P_COLOR },
              { label: "Σp", value: (lightMass * explosionLive.v2 + heavyMass * explosionLive.v1).toFixed(4), unit: "кг·м/с" },
            ]}
          />
        )
      }
      graphs={
        scenario === "pendulum" ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">θ(t) — угол качания маятника</p>
            <LiveChart data={pendulumSeries} xKey="t" xLabel="t, с" series={[{ key: "thetaDeg", color: "#5eead4", label: "θ, °" }]} />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">p(t) — импульс сохраняется</p>
            <LiveChart
              data={explosionSeries}
              xKey="t"
              xLabel="t, с"
              series={[
                { key: "p1", color: "#fbbf24", label: skaters ? "p взрослого" : "p пушки" },
                { key: "p2", color: P_COLOR, label: skaters ? "p ребёнка" : "p ядра" },
                { key: "pTotal", color: "#f4f4f5", label: "Σp" },
              ]}
            />
          </div>
        )
      }
      note={
        scenario === "pendulum" ? (
          <>
            Пуля застревает в бруске — абсолютно неупругий удар: скорость сразу после удара v' = mv₀/(m+M). Дальше брусок с
            пулей качается как маятник, кинетическая энергия переходит в потенциальную: v'²/2 = gh, откуда h = v'²/(2g). Измерив
            высоту подъёма h, можно найти исходную скорость пули v₀ = ((M+m)/m)·√(2gh) — так работает баллистический маятник,
            классический способ измерить скорость пули, не имея радара. Пуля на сцене увеличена, чтобы её было видно.
          </>
        ) : skaters ? (
          <>
            До толчка оба стоят на месте, Σp = 0. По закону сохранения импульса m_взр·v_взр = −m_реб·v_реб — более лёгкий
            (ребёнок) уезжает быстрее, более тяжёлый (взрослый) — медленнее, но их импульсы (фиолетовые стрелки) одинаковы по
            длине. Скорость {pLight > 0 ? "ребёнка" : ""} в {f1(heavyMass / lightMass)} раза больше — ровно во столько, во сколько он легче.
          </>
        ) : (
          <>
            До выстрела Σp = 0. По закону сохранения импульса M·v_пушки = −m·v_ядра, откуда v_пушки = −m·v_ядра/M — пушка
            откатывается назад, ядро летит вперёд. Зелёные стрелки скорости очень разные, а фиолетовые стрелки импульса —
            одинаковой длины: суммарный импульс остаётся нулевым. Так же работает отдача ружья и реактивное движение.
          </>
        )
      }
    />
  );
}
