import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { Trail } from "@react-three/drei";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Cannon, CANNON_PIVOT_Y } from "@/components/sim/props/mechanics";
import { Basketball, BasketballHoop, Cannonball, FootballGoal, SoccerBall } from "@/components/sim/props/sport";
import { Person } from "@/components/sim/props/Person";
import { KICK, THROW_UP, pose } from "@/components/sim/props/pose";
import { DistancePost, Ground, Tree } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

const G = 9.8;
const X_LAUNCH = -1;
const V_SCALE = 0.22;
const COLOR_NODRAG = "#7c6cf5";
const COLOR_DRAG = "#fbbf24";
const COLOR_VX = "#38bdf8";
const COLOR_VY = "#f472b6";
const CANNON_SCALE = 2.2;
const CANNON_PIVOT = CANNON_PIVOT_Y * CANNON_SCALE;

// ---- closed-form: no air resistance ----
// x(t) = x0 + vx0 t ; y(t) = h0 + vy0 t - 1/2 g t^2
function noDragPosition(vx0: number, vy0: number, h0: number, t: number) {
  return { x: X_LAUNCH + vx0 * t, y: h0 + vy0 * t - 0.5 * G * t * t, vy: vy0 - G * t };
}
// 0 = h0 + vy0 t - 1/2 g t^2  =>  t = (vy0 + sqrt(vy0^2 + 2 g h0)) / g
function landingTimeNoDrag(vy0: number, h0: number) {
  return (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * h0)) / G;
}
function maxHeightNoDrag(vy0: number, h0: number) {
  return vy0 > 0 ? h0 + (vy0 * vy0) / (2 * G) : h0;
}

// ---- quadratic-drag ODE, integrated with fixed-step RK4 (no analytic solution exists) ----
interface State2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
function derivative(s: State2D, k: number) {
  const speed = Math.hypot(s.vx, s.vy);
  return { x: s.vx, y: s.vy, vx: -k * speed * s.vx, vy: -G - k * speed * s.vy };
}
function rk4Step(s: State2D, dt: number, k: number): State2D {
  const a = derivative(s, k);
  const s2: State2D = { x: s.x + (a.x * dt) / 2, y: s.y + (a.y * dt) / 2, vx: s.vx + (a.vx * dt) / 2, vy: s.vy + (a.vy * dt) / 2 };
  const b = derivative(s2, k);
  const s3: State2D = { x: s.x + (b.x * dt) / 2, y: s.y + (b.y * dt) / 2, vx: s.vx + (b.vx * dt) / 2, vy: s.vy + (b.vy * dt) / 2 };
  const c = derivative(s3, k);
  const s4: State2D = { x: s.x + c.x * dt, y: s.y + c.y * dt, vx: s.vx + c.vx * dt, vy: s.vy + c.vy * dt };
  const d = derivative(s4, k);
  return {
    x: s.x + (dt / 6) * (a.x + 2 * b.x + 2 * c.x + d.x),
    y: s.y + (dt / 6) * (a.y + 2 * b.y + 2 * c.y + d.y),
    vx: s.vx + (dt / 6) * (a.vx + 2 * b.vx + 2 * c.vx + d.vx),
    vy: s.vy + (dt / 6) * (a.vy + 2 * b.vy + 2 * c.vy + d.vy),
  };
}

interface SamplePoint {
  t: number;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  v1: number;
  v2?: number;
  [key: string]: number | undefined;
}

interface LiveNumbers {
  t: number;
  x1: number;
  y1: number;
  v1: number;
  vy1: number;
  x2: number;
  y2: number;
  v2: number;
  landed1: boolean;
  landed2: boolean;
  range2: number;
  maxH2: number;
}

type Scenario = "abstract" | "basketball" | "football";

const HOOP_X = 6;
const HOOP_Y = 3.05;
const HOOP_R = 0.23;
const HOOP_TOLERANCE = 0.32;
const WALL_X = 9;
const WALL_H = 2.0;
const GOAL_X = 18;
const GOAL_H = 2.44;
const FOOTBALL_H0 = 0.11;

/* ---------------- scenery ---------------- */

function CannonRange({ h0, angleDeg, simplified }: { h0: number; angleDeg: number; simplified: boolean }) {
  const mound = Math.max(0, h0 - CANNON_PIVOT);
  const posts = [10, 20, 30, 40, 50, 60];
  return (
    <group>
      <Ground kind="grass" from={-25} to={95} width={46} tile={10} tileZ={10} y={-0.01} />
      {mound > 0.02 && (
        <mesh position={[X_LAUNCH - 0.4, mound / 2, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[2.6, 4.2, mound, 28]} />
          <meshStandardMaterial color="#4d5b2f" roughness={0.95} />
        </mesh>
      )}
      <Cannon position={[X_LAUNCH, mound, 0]} elevationDeg={angleDeg} scale={CANNON_SCALE} />
      <SceneLabel position={[X_LAUNCH - 1.5, mound + 3.6, 0]}>пушка</SceneLabel>
      {posts.map((d) => (
        <DistancePost key={d} text={`${d} м`} position={[X_LAUNCH + d, 0, -3]} scale={2} />
      ))}
      {!simplified &&
        [
          [70, -12, 9],
          [48, -16, 8],
          [22, -15, 7],
          [84, -10, 10],
          [-14, -12, 8],
        ].map(([x, z, h], i) => <Tree key={i} position={[x, 0, z]} height={h} seed={i + 3} conifer={i % 2 === 0} />)}
    </group>
  );
}

function Court({ h0 }: { h0: number }) {
  const scale = THREE.MathUtils.clamp(h0 / 2.05, 0.8, 1.25);
  return (
    <group>
      <Ground kind="parquet" from={-8} to={12} width={14} tile={4} tileZ={4} y={-0.01} />
      {/* painted key and three-point arc */}
      <mesh position={[HOOP_X - 2.4, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.8, 4.9]} />
        <meshStandardMaterial color="#b45309" roughness={0.85} transparent opacity={0.55} />
      </mesh>
      <mesh position={[HOOP_X, 0.004, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
        <ringGeometry args={[6.7, 6.78, 64, 1, Math.PI * 0.12, Math.PI * 0.76]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <BasketballHoop position={[HOOP_X, HOOP_Y, 0]} rimRadius={HOOP_R} />
      <Person position={[X_LAUNCH - 0.28, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={scale} pose={THROW_UP} shirt="#facc15" pants="#6d28d9" skin="#8d5a3b" hair="#111" />
      <SceneLabel position={[HOOP_X, HOOP_Y + 1.45, 0]}>кольцо 3,05 м</SceneLabel>
      <SceneLabel position={[X_LAUNCH - 0.3, 0.35, 0.9]}>7 м до кольца</SceneLabel>
    </group>
  );
}

function FootballPitch() {
  const wall = [-0.75, -0.25, 0.25, 0.75];
  return (
    <group>
      <Ground kind="grass" from={-15} to={40} width={40} tile={5} tileZ={40} y={-0.01} />
      {/* goal line + penalty area line */}
      <mesh position={[GOAL_X, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.12, 30]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[GOAL_X - 16.5, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.12, 30]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <Person position={[X_LAUNCH - 1.0, 0, 0.35]} rotation={[0, Math.PI / 2, 0]} pose={KICK} shirt="#dc2626" pants="#f8fafc" />
      {wall.map((dz, i) => (
        <Person
          key={dz}
          position={[WALL_X, 0, dz]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={1.08 + (i % 2) * 0.04}
          pose={pose({ shoulderL: 0.5, shoulderR: 0.5, elbowL: 1.5, elbowR: 1.5, spreadL: -0.1, spreadR: -0.1 })}
          shirt="#1d4ed8"
          pants="#0f172a"
          skin={i % 2 ? "#e8b48a" : "#a0694a"}
        />
      ))}
      <FootballGoal position={[GOAL_X, 0, 0]} />
      <SceneLabel position={[WALL_X, 2.55, 0]}>стенка, 9 м</SceneLabel>
      <SceneLabel position={[GOAL_X, GOAL_H + 0.55, 0]}>ворота, перекладина 2,44 м</SceneLabel>
    </group>
  );
}

/* ---------------- scene ---------------- */

interface SceneContentProps {
  scenario: Scenario;
  angleDeg: number;
  v0: number;
  h0: number;
  withDrag: boolean;
  k: number;
  /** where the free flight ends early: through the hoop, into the backboard, the wall or the goal net */
  block: Block | null;
  running: boolean;
  speed: number;
  simplified: boolean;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onFinished: () => void;
}

interface Block {
  t: number;
  x: number;
  y: number;
}

function SceneContent({ scenario, angleDeg, v0, h0, withDrag, k, block, running, speed, simplified, onSample, onLive, onFinished }: SceneContentProps) {
  const rad = (angleDeg * Math.PI) / 180;
  const vx0 = v0 * Math.cos(rad);
  const vy0 = v0 * Math.sin(rad);
  const tLand1 = useMemo(() => landingTimeNoDrag(vy0, h0), [vy0, h0]);
  const ballR = scenario === "abstract" ? 0.28 : scenario === "basketball" ? 0.12 : 0.11;
  /** after an obstacle the ball simply drops from where it was stopped */
  const tStop1 = block ? block.t + Math.sqrt((2 * Math.max(0, block.y - ballR)) / G) : tLand1;
  const ballAt = useCallback(
    (t: number) => {
      if (block && t >= block.t) {
        const tau = t - block.t;
        return { x: block.x, y: Math.max(ballR, block.y - 0.5 * G * tau * tau), vy: -G * tau, flying: false };
      }
      const p = noDragPosition(vx0, vy0, h0, Math.min(t, tLand1));
      return { x: p.x, y: Math.max(p.y, ballR), vy: p.vy, flying: t < tLand1 };
    },
    [block, ballR, vx0, vy0, h0, tLand1],
  );

  const ball1Ref = useRef<THREE.Mesh>(null!);
  const ball2Ref = useRef<THREE.Mesh>(null!);
  const smoke = useRef<THREE.Group>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const vxArrow = useRef<VectorArrowHandle>(null);
  const vyArrow = useRef<VectorArrowHandle>(null);

  const drag2 = useRef<State2D>({ x: X_LAUNCH, y: h0, vx: vx0, vy: vy0 });
  const landed1Ref = useRef(false);
  const landed2Ref = useRef(!withDrag);
  const finishedRef = useRef(false);
  const maxH2Ref = useRef(h0);
  const range2Ref = useRef(X_LAUNCH);

  const handleFixedStep = useCallback(
    (dt: number) => {
      if (!withDrag || landed2Ref.current) return;
      const prev = drag2.current;
      const next = rk4Step(prev, dt, k);
      if (next.y <= 0 && prev.y > 0) {
        const frac = prev.y / (prev.y - next.y);
        next.x = prev.x + (next.x - prev.x) * frac;
        next.y = 0;
        landed2Ref.current = true;
        range2Ref.current = next.x;
      }
      drag2.current = next;
      maxH2Ref.current = Math.max(maxH2Ref.current, next.y);
    },
    [withDrag, k],
  );

  const emit = useCallback(
    (t: number) => {
      const p1 = ballAt(Math.min(t, tStop1));
      const speed1 = p1.flying ? Math.hypot(vx0, p1.vy) : t >= tStop1 ? 0 : Math.abs(p1.vy);
      const s2 = drag2.current;
      const speed2 = Math.hypot(s2.vx, s2.vy);
      onSample({
        t,
        x1: p1.x,
        y1: p1.y,
        v1: speed1,
        ...(withDrag ? { x2: s2.x, y2: Math.max(s2.y, 0), v2: speed2 } : {}),
      });
      onLive({
        t,
        x1: p1.x,
        y1: p1.y,
        v1: speed1,
        vy1: p1.flying ? p1.vy : 0,
        x2: s2.x,
        y2: Math.max(s2.y, 0),
        v2: speed2,
        landed1: t >= tStop1,
        landed2: landed2Ref.current,
        range2: range2Ref.current,
        maxH2: maxH2Ref.current,
      });
    },
    [ballAt, tStop1, vx0, withDrag, onSample, onLive],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const landed1 = t >= tStop1;
      landed1Ref.current = landed1;
      const clampedT1 = Math.min(t, tStop1);
      // the trajectory point is the ball centre; after landing the ball rests on the ground
      const p1 = ballAt(clampedT1);
      const y1 = p1.y;
      if (ball1Ref.current) {
        ball1Ref.current.position.set(p1.x, y1, 0);
        // the ball spins as it flies (backspin for a shot, slow tumble for a cannonball)
        ball1Ref.current.rotation.z = scenario === "basketball" ? clampedT1 * 9 : -clampedT1 * 4;
      }
      if (!p1.flying) {
        vArrow.current?.hide();
        vxArrow.current?.hide();
        vyArrow.current?.hide();
      } else {
        vArrow.current?.set([p1.x, y1, 0.02], [vx0 * V_SCALE, p1.vy * V_SCALE, 0]);
        vxArrow.current?.set([p1.x, y1, 0.04], [vx0 * V_SCALE, 0, 0]);
        vyArrow.current?.set([p1.x, y1, 0.04], [0, p1.vy * V_SCALE, 0]);
      }

      const s2 = drag2.current;
      if (withDrag && ball2Ref.current) ball2Ref.current.position.set(s2.x, Math.max(s2.y, ballR), 0);

      if (smoke.current) {
        const show = scenario === "abstract" && t < 1.2;
        smoke.current.visible = show;
        if (show) {
          const k2 = t / 1.2;
          smoke.current.scale.setScalar(0.4 + k2 * 2.6);
          smoke.current.children.forEach((child) => {
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
            mat.opacity = 0.55 * (1 - k2);
          });
        }
      }

      if (landed1 && (!withDrag || landed2Ref.current) && !finishedRef.current) {
        finishedRef.current = true;
        // a last sample so the numbers and the subtitle show the final state, then freeze the clock
        emit(t);
        onFinished();
      }
    },
    [tStop1, ballAt, vx0, withDrag, onFinished, scenario, ballR, emit],
  );

  const muzzle = useMemo(() => {
    const mound = Math.max(0, h0 - CANNON_PIVOT);
    const len = 1.2 * CANNON_SCALE;
    return new THREE.Vector3(X_LAUNCH + Math.cos(rad) * len, mound + CANNON_PIVOT + Math.sin(rad) * len, 0);
  }, [h0, rad]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFixedStep={withDrag ? handleFixedStep : undefined}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={emit}
      />
      {scenario === "basketball" ? <Court h0={h0} /> : scenario === "football" ? <FootballPitch /> : <CannonRange h0={h0} angleDeg={angleDeg} simplified={simplified} />}

      {scenario === "abstract" && (
        <group ref={smoke} position={muzzle}>
          {[
            [0, 0, 0, 0.5],
            [0.35, 0.15, 0.1, 0.38],
            [0.2, 0.35, -0.15, 0.32],
            [0.55, -0.05, -0.1, 0.3],
          ].map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]}>
              <sphereGeometry args={[r, 12, 10]} />
              <meshStandardMaterial color="#d4d4d8" transparent opacity={0.5} depthWrite={false} roughness={1} />
            </mesh>
          ))}
        </group>
      )}

      <Trail width={scenario === "abstract" ? 3 : 1.6} length={scenario === "abstract" ? 9 : 5} color={COLOR_NODRAG} attenuation={(w) => w} target={ball1Ref}>
        {scenario === "basketball" ? (
          <Basketball ref={ball1Ref} radius={ballR} position={[X_LAUNCH, h0, 0]} />
        ) : scenario === "football" ? (
          <SoccerBall ref={ball1Ref} radius={ballR} position={[X_LAUNCH, h0, 0]} />
        ) : (
          <Cannonball ref={ball1Ref} radius={ballR} position={[X_LAUNCH, h0, 0]} />
        )}
      </Trail>

      {withDrag && (
        <Trail width={scenario === "abstract" ? 3 : 1.6} length={scenario === "abstract" ? 9 : 5} color={COLOR_DRAG} attenuation={(w) => w} target={ball2Ref}>
          <mesh ref={ball2Ref} position={[X_LAUNCH, h0, 0]} castShadow>
            <sphereGeometry args={[ballR, 24, 18]} />
            <meshStandardMaterial color={COLOR_DRAG} emissive={COLOR_DRAG} emissiveIntensity={0.35} transparent opacity={0.75} roughness={0.35} metalness={0.3} />
          </mesh>
        </Trail>
      )}

      <VectorArrow ref={vArrow} color="#4ade80" />
      <VectorArrow ref={vxArrow} color={COLOR_VX} shaftRadius={0.025} headRadius={0.07} />
      <VectorArrow ref={vyArrow} color={COLOR_VY} shaftRadius={0.025} headRadius={0.07} />
    </>
  );
}

function stageForScenario(scenario: Scenario): { camera: { position: [number, number, number]; fov: number }; orbitTarget: [number, number, number]; max: number; fog: [number, number] } {
  if (scenario === "basketball") return { camera: { position: [2.5, 3.2, 11], fov: 55 }, orbitTarget: [2.5, 2, 0], max: 40, fog: [16, 45] };
  if (scenario === "football") return { camera: { position: [3, 5.5, 21], fov: 55 }, orbitTarget: [9, 1.6, 0], max: 60, fog: [26, 70] };
  return { camera: { position: [20, 12, 46], fov: 60 }, orbitTarget: [20, 6, 0], max: 100, fog: [55, 130] };
}

const DEFAULTS: Record<Scenario, { angleDeg: number; v0: number; withDrag: boolean }> = {
  basketball: { angleDeg: 50, v0: 8.9, withDrag: false },
  football: { angleDeg: 18, v0: 22, withDrag: false },
  abstract: { angleDeg: 45, v0: 20, withDrag: true },
};

const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function ProjectileMotionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const [c, set] = useControls("Баллистика", () => ({
    scenario: {
      value: "basketball",
      label: "Жизненный пример",
      options: { "Баскетбол: бросок в кольцо": "basketball", "Футбол: штрафной через стенку": "football", "Пушка: выстрел ядром": "abstract" },
    },
    angleDeg: { value: 50, min: 5, max: 85, step: 1, label: "угол α, °" },
    v0: { value: 8.9, min: 4, max: 25, step: 0.1, label: "v₀, м/с" },
    h0Throw: { value: 2.1, min: 1.6, max: 2.6, step: 0.05, label: "высота броска h₀, м", render: (get) => get("Баллистика.scenario") === "basketball" },
    h0Cannon: { value: CANNON_PIVOT, min: CANNON_PIVOT, max: 6, step: 0.1, label: "высота ствола h₀, м", render: (get) => get("Баллистика.scenario") === "abstract" },
    withDrag: { value: false, label: "сопротивление воздуха" },
    k: {
      value: 0.012,
      min: 0.001,
      max: 0.03,
      step: 0.001,
      label: "коэфф. сопротивления k",
      render: (get) => get("Баллистика.withDrag"),
    },
  }));
  const scenario = c.scenario as Scenario;
  const { angleDeg, v0, withDrag, k } = c;
  const h0 = scenario === "basketball" ? c.h0Throw : scenario === "football" ? FOOTBALL_H0 : c.h0Cannon;

  // each life example starts from numbers that make sense for it (a made shot, a goal, a long cannon shot)
  const lastScenario = useRef(scenario);
  useEffect(() => {
    if (lastScenario.current === scenario) return;
    lastScenario.current = scenario;
    set(DEFAULTS[scenario]);
  }, [scenario, set]);

  const rad = (angleDeg * Math.PI) / 180;
  const vx0 = v0 * Math.cos(rad);
  const vy0 = v0 * Math.sin(rad);
  const predictedT = landingTimeNoDrag(vy0, h0);
  const predictedRange = X_LAUNCH + vx0 * predictedT;
  const predictedMaxH = maxHeightNoDrag(vy0, h0);

  const yAt = (x: number) => {
    const t = (x - X_LAUNCH) / vx0;
    return { t, y: h0 + vy0 * t - 0.5 * G * t * t, vy: vy0 - G * t };
  };
  const hoop = yAt(HOOP_X);
  const basketMade = hoop.t > 0 && hoop.t < predictedT && hoop.vy < 0 && Math.abs(hoop.y - HOOP_Y) < HOOP_TOLERANCE;

  const wall = yAt(WALL_X);
  const clearsWall = wall.t > 0 && wall.t < predictedT && wall.y > WALL_H;
  const goalLine = yAt(GOAL_X);
  const reachesGoal = goalLine.t > 0 && goalLine.t < predictedT;
  const goalScored = clearsWall && reachesGoal && goalLine.y < GOAL_H;

  // obstacles: the ball drops through the net, bounces off the board, hits the wall or stays in the goal net
  const block = useMemo<Block | null>(() => {
    if (scenario === "basketball") {
      if (basketMade) return { t: hoop.t, x: HOOP_X, y: HOOP_Y };
      const boardX = HOOP_X + HOOP_R + 0.12;
      const board = yAt(boardX);
      if (board.t > 0 && board.t < predictedT && board.y > HOOP_Y - 0.12 && board.y < HOOP_Y + 0.95) return { t: board.t, x: boardX - 0.15, y: board.y };
      return null;
    }
    if (scenario === "football") {
      if (!clearsWall && wall.t > 0 && wall.t < predictedT) return { t: wall.t, x: WALL_X - 0.4, y: Math.max(wall.y, 0.11) };
      if (goalScored) {
        const net = yAt(GOAL_X + 1.3);
        if (net.t < predictedT) return { t: net.t, x: GOAL_X + 1.3, y: net.y };
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, basketMade, clearsWall, goalScored, angleDeg, v0, h0]);

  const runKey = `${clock.resetNonce}|${scenario}|${angleDeg}|${v0}|${h0}|${withDrag}|${k}`;
  const initialLive = useMemo<LiveNumbers>(
    () => ({ t: 0, x1: X_LAUNCH, y1: h0, v1: v0, vy1: vy0, x2: X_LAUNCH, y2: h0, v2: v0, landed1: false, landed2: !withDrag, range2: X_LAUNCH, maxH2: h0 }),
    [h0, v0, vy0, withDrag],
  );
  const [live, setLive] = useState<LiveNumbers>(initialLive);
  const [series, setSeries] = useState<SamplePoint[]>([]);

  const play = clock.play;
  useEffect(() => {
    setLive(initialLive);
    setSeries([{ t: 0, x1: X_LAUNCH, y1: initialLive.y1, v1: initialLive.v1, ...(withDrag ? { x2: X_LAUNCH, y2: initialLive.y1, v2: initialLive.v1 } : {}) }]);
    play();
  }, [runKey, initialLive, withDrag, play]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 600 ? prev : [...prev, p]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const stage = stageForScenario(scenario);
  const objectName = scenario === "abstract" ? "Ядро" : "Мяч";

  let caption: ReactNode;
  if (live.landed1) {
    if (scenario === "basketball") {
      caption = basketMade ? (
        <><b>ПОПАЛ!</b> Мяч прошёл через кольцо на спуске (v_y &lt; 0). Попробуйте другой угол — найдутся два решения: «навесной» и «прямой» бросок.</>
      ) : (
        <><b>Мимо.</b> Над кольцом (7 м) мяч оказался на высоте {f2(Math.max(hoop.y, 0))} м, а нужно 3,05 м и обязательно на спуске. Поменяйте угол или скорость.</>
      );
    } else if (scenario === "football") {
      caption = !clearsWall ? (
        <><b>Мяч в стенке.</b> На расстоянии 9 м он был на высоте {f2(Math.max(wall.y, 0))} м — ниже голов защитников (2 м). Нужен угол побольше.</>
      ) : goalScored ? (
        <><b>ГОЛ!</b> Мяч перелетел стенку на высоте {f2(wall.y)} м и пересёк линию ворот на высоте {f2(goalLine.y)} м — под перекладиной.</>
      ) : !reachesGoal ? (
        <><b>Не долетел</b> до ворот: упал через {f2(predictedT)} с. Добавьте скорости.</>
      ) : (
        <><b>Выше ворот:</b> на линии ворот мяч был на высоте {f2(goalLine.y)} м, а перекладина — 2,44 м.</>
      );
    } else {
      caption = withDrag && live.landed2 ? (
        <><b>Упало.</b> Без сопротивления воздуха ядро улетело бы на {f1(predictedRange - X_LAUNCH)} м, а с сопротивлением — только на {f1(live.range2 - X_LAUNCH)} м. Воздух «съедает» скорость, и траектория перестаёт быть параболой.</>
      ) : (
        <><b>Упало</b> через {f2(predictedT)} с на расстоянии {f1(predictedRange - X_LAUNCH)} м. Наибольшая высота была {f1(predictedMaxH)} м.</>
      );
    }
  } else if (live.t < 0.08) {
    caption = <>{scenario === "abstract" ? "Выстрел!" : "Бросок!"} {objectName} вылетает под углом {angleDeg}° со скоростью {f1(v0)} м/с. Её разложим на две части: vₓ = {f1(vx0)} м/с и v_y = {f1(vy0)} м/с.</>;
  } else if (live.vy1 > 0.35) {
    caption = <><b>Подъём.</b> Горизонтальная скорость vₓ = {f1(vx0)} м/с не меняется (голубая стрелка), а вертикальная v_y уменьшается на 9,8 м/с каждую секунду (розовая стрелка).</>;
  } else if (live.vy1 > -0.35) {
    caption = <><b>Верхняя точка:</b> v_y = 0, высота {f1(predictedMaxH)} м. Скорость здесь наименьшая, но не нулевая — остаётся vₓ.</>;
  } else {
    caption = <><b>Спуск.</b> Вертикальная скорость растёт вниз, горизонтальная — всё та же {f1(vx0)} м/с. Вместе они дают параболу.</>;
  }

  const legend: LegendItem[] = [
    { color: "#4ade80", label: "скорость v" },
    { color: COLOR_VX, label: "vₓ (постоянна)" },
    { color: COLOR_VY, label: "v_y (меняет g)" },
    { color: COLOR_NODRAG, label: "след без сопротивления", kind: "line" },
    ...(withDrag ? [{ color: COLOR_DRAG, label: "с сопротивлением воздуха", kind: "line" as const }] : []),
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={stage.camera} orbitTarget={stage.orbitTarget} simplified={isMobile} maxDistance={stage.max} minDistance={4} bloomThreshold={0.6} fogRange={stage.fog}>
          <SceneContent
            key={runKey}
            scenario={scenario}
            angleDeg={angleDeg}
            v0={v0}
            h0={h0}
            withDrag={withDrag}
            k={k}
            block={block}
            running={clock.running}
            speed={clock.speed}
            simplified={isMobile}
            onSample={handleSample}
            onLive={setLive}
            onFinished={handleFinished}
          />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        <div className="flex flex-col gap-3">
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "x без сопр.", value: live.x1.toFixed(1), unit: "м", color: COLOR_NODRAG },
              { label: "y без сопр.", value: live.y1.toFixed(1), unit: "м", color: COLOR_NODRAG },
              { label: "v без сопр.", value: live.v1.toFixed(1), unit: "м/с" },
              { label: "vₓ", value: vx0.toFixed(1), unit: "м/с", color: COLOR_VX },
              { label: "v_y", value: (live.landed1 ? 0 : live.vy1).toFixed(1), unit: "м/с", color: COLOR_VY },
              ...(withDrag
                ? [
                    { label: "x с сопр.", value: live.x2.toFixed(1), unit: "м", color: COLOR_DRAG },
                    { label: "v с сопр.", value: live.v2.toFixed(1), unit: "м/с" },
                  ]
                : []),
            ]}
          />
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Прогноз без сопротивления</p>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Дальность L</span>
              <span className="font-mono tabular-nums">{(predictedRange - X_LAUNCH).toFixed(1)} м</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Макс. высота H</span>
              <span className="font-mono tabular-nums">{predictedMaxH.toFixed(1)} м</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Время полёта T</span>
              <span className="font-mono tabular-nums">{predictedT.toFixed(2)} с</span>
            </div>
            {withDrag && live.landed2 && (
              <>
                <div className="mt-2 border-t border-border pt-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Фактически с сопротивлением</div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted">Дальность</span>
                  <span className="font-mono tabular-nums">{(live.range2 - X_LAUNCH).toFixed(1)} м</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted">Макс. высота</span>
                  <span className="font-mono tabular-nums">{live.maxH2.toFixed(1)} м</span>
                </div>
              </>
            )}
            {scenario === "basketball" && (
              <div className={cn("mt-2 border-t border-border pt-2 text-sm font-semibold", basketMade ? "text-emerald-400" : "text-red-400")}>
                {basketMade ? "ПОПАЛ! 🏀" : "МИМО"}
              </div>
            )}
            {scenario === "football" && (
              <div className={cn("mt-2 border-t border-border pt-2 text-sm font-semibold", goalScored ? "text-emerald-400" : "text-red-400")}>
                {!clearsWall ? "МЯЧ В СТЕНКЕ" : goalScored ? "ГОЛ! ⚽" : !reachesGoal ? "НЕ ДОЛЕТЕЛ" : "ВЫШЕ ВОРОТ"}
              </div>
            )}
          </div>
        </div>
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">y(x) — траектория</p>
            <LiveChart
              data={series}
              xKey="x1"
              xLabel="x, м"
              yLabel="y, м"
              series={
                withDrag
                  ? [
                      { key: "y1", color: COLOR_NODRAG, label: "без сопр." },
                      { key: "y2", color: COLOR_DRAG, label: "с сопр." },
                    ]
                  : [{ key: "y1", color: COLOR_NODRAG, label: "y(x)" }]
              }
            />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">v(t) — скорость</p>
            <LiveChart
              data={series}
              xKey="t"
              xLabel="t, с"
              series={
                withDrag
                  ? [
                      { key: "v1", color: COLOR_NODRAG, label: "без сопр." },
                      { key: "v2", color: COLOR_DRAG, label: "с сопр." },
                    ]
                  : [{ key: "v1", color: COLOR_NODRAG, label: "v(t)" }]
              }
            />
          </div>
        </div>
      }
      note={
        scenario === "basketball" ? (
          <>
            Кольцо висит на высоте 3,05 м, бросок — с 7 м (почти трёхочковый). Попадание засчитывается, если мяч проходит через
            кольцо (±{HOOP_TOLERANCE} м) на спуске. Скорость раскладывается на vₓ = v₀cos α (не меняется) и v_y = v₀sin α − gt
            (тяготение уменьшает её на 9,8 м/с каждую секунду) — поэтому траектория парабола.
          </>
        ) : scenario === "football" ? (
          <>
            Стенка стоит в 9 м от мяча (по правилам — 9,15 м), высота защитников с прыжком ≈ 2 м, перекладина ворот — 2,44 м.
            Мяч должен быть выше стенки на 9 м и ниже перекладины на линии ворот: окно для удачного удара очень узкое — поэтому
            штрафные так редко залетают.
          </>
        ) : (
          <>
            Без сопротивления (фиолетовый след) — точная формула x(t) = x₀ + v₀cos α·t, y(t) = h₀ + v₀sin α·t − ½gt². С
            сопротивлением (жёлтое ядро) — численное интегрирование (RK4) уравнения a = −g − k·v·|v| с фиксированным шагом.
            Без воздуха дальше всего летит выстрел под 45°, с воздухом — под углом поменьше.
          </>
        )
      }
    />
  );
}
