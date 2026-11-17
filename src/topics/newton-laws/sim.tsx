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
import { Dynamometer, LabCart, Trailer, TRAILER_KINGPIN_X, Truck, TRUCK_COUPLING_X } from "@/components/sim/props/vehicles";
import { BathroomScale, ElevatorCab, Rod, type RodHandle } from "@/components/sim/props/mechanics";
import { Person } from "@/components/sim/props/Person";
import { pose, STAND, type PoseAngles } from "@/components/sim/props/pose";
import { DistancePost, Ground, LabBench, Tree } from "@/components/sim/props/environment";
import { brickTexture, textTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const G = 9.8;
const TRACK_LEN = 7;
const V_SCALE = 0.35;
const A_SCALE = 0.5;
const F_COLOR = "#fb923c";
const T_COLOR = "#22d3ee";

/* ------------------------------------------------------------------ */
/* elevator ride: accelerate → cruise → brake, or a snapped cable       */
/* ------------------------------------------------------------------ */

type Ride = "up" | "down" | "fall";
type RidePhase = "accel" | "cruise" | "brake" | "stop" | "fall" | "catch";
const T_ACC = 2;
const T_CRUISE = 3;
const T_FREE = 1.2;
const CATCH_A = 15;
const BUILDING_H = 42;
const START_Y: Record<Ride, number> = { up: 0, down: 33, fall: 30 };

interface RideState {
  y: number;
  v: number;
  acc: number;
  phase: RidePhase;
}

function rideAt(ride: Ride, a: number, t: number): RideState {
  if (ride === "fall") {
    if (t < T_FREE) return { y: -0.5 * G * t * t, v: -G * t, acc: -G, phase: "fall" };
    const vf = -G * T_FREE;
    const tau = t - T_FREE;
    const tb = -vf / CATCH_A;
    const y0 = -0.5 * G * T_FREE * T_FREE;
    if (tau < tb) return { y: y0 + vf * tau + 0.5 * CATCH_A * tau * tau, v: vf + CATCH_A * tau, acc: CATCH_A, phase: "catch" };
    return { y: y0 + vf * tb + 0.5 * CATCH_A * tb * tb, v: 0, acc: 0, phase: "stop" };
  }
  const dir = ride === "up" ? 1 : -1;
  const vmax = a * T_ACC;
  const s1 = 0.5 * a * T_ACC * T_ACC;
  if (t < T_ACC) return { y: dir * 0.5 * a * t * t, v: dir * a * t, acc: dir * a, phase: "accel" };
  if (t < T_ACC + T_CRUISE) return { y: dir * (s1 + vmax * (t - T_ACC)), v: dir * vmax, acc: 0, phase: "cruise" };
  const tau = t - T_ACC - T_CRUISE;
  if (tau < T_ACC) return { y: dir * (s1 + vmax * T_CRUISE + vmax * tau - 0.5 * a * tau * tau), v: dir * (vmax - a * tau), acc: -dir * a, phase: "brake" };
  return { y: dir * (2 * s1 + vmax * T_CRUISE), v: 0, acc: 0, phase: "stop" };
}

function rideEnd(ride: Ride) {
  return ride === "fall" ? T_FREE + (G * T_FREE) / CATCH_A : 2 * T_ACC + T_CRUISE;
}

interface ElevatorLive {
  t: number;
  ride: RideState;
}

function Building() {
  const brick = useMemo(() => {
    const t = brickTexture().clone();
    t.repeat.set(3, 14);
    t.needsUpdate = true;
    return t;
  }, []);
  const floors = useMemo(() => Array.from({ length: Math.floor(BUILDING_H / 3) }, (_, i) => i), []);
  return (
    <group>
      <Ground kind="tiles" from={-14} to={14} width={20} tile={3} tileZ={3} y={-0.06} />
      <mesh position={[0, BUILDING_H / 2, -1.25]} receiveShadow>
        <boxGeometry args={[7, BUILDING_H, 0.4]} />
        <meshStandardMaterial map={brick} roughness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.95, BUILDING_H / 2, -0.85]}>
          <boxGeometry args={[0.12, BUILDING_H, 0.12]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      {floors.map((i) => (
        <group key={i} position={[0, i * 3, 0]}>
          <mesh position={[-2.6, -0.05, -0.6]}>
            <boxGeometry args={[1.8, 0.12, 1.0]} />
            <meshStandardMaterial color="#52525b" roughness={0.8} />
          </mesh>
          <mesh position={[-2.6, 1.6, -1.04]}>
            <planeGeometry args={[0.6, 0.45]} />
            <meshStandardMaterial map={textTexture(`${i + 1} эт.`, { color: "#f8fafc", background: "#1e3a8a", font: "bold 44px sans-serif", width: 192, height: 128 })} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, BUILDING_H + 0.4, -0.4]}>
        <boxGeometry args={[2.4, 0.8, 1.6]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

interface ElevatorSceneProps {
  ride: Ride;
  a: number;
  mPerson: number;
  running: boolean;
  speed: number;
  onLive: (n: ElevatorLive) => void;
  onFinished: () => void;
}

function SceneElevator({ ride, a, mPerson, running, speed, onLive, onFinished }: ElevatorSceneProps) {
  const cab = useRef<THREE.Group>(null!);
  const cable = useRef<RodHandle>(null);
  const aArrow = useRef<VectorArrowHandle>(null);
  const nArrow = useRef<VectorArrowHandle>(null);
  const gArrow = useRef<VectorArrowHandle>(null);
  const poseRef = useRef<PoseAngles>(STAND);
  const finished = useRef(false);
  const y0 = START_Y[ride];
  const end = rideEnd(ride);
  const floating = useMemo(() => pose({ spreadL: 1.2, spreadR: 1.2, shoulderL: 0.4, shoulderR: 0.4, elbowL: 0.4, elbowR: 0.4 }), []);

  const handleFrame = useCallback(
    (t: number) => {
      const s = rideAt(ride, a, t);
      const y = y0 + s.y;
      if (cab.current) cab.current.position.y = y;
      cable.current?.set([0, y + 2.5, 0], [0, BUILDING_H, 0]);
      aArrow.current?.set([1.2, y + 1.2, 0.3], [0, s.acc * 0.16, 0]);
      const N = Math.max(0, mPerson * (G + s.acc));
      nArrow.current?.set([0.32, y + 0.06, 0.15], [0, (N / (mPerson * G)) * 0.9, 0]);
      gArrow.current?.set([-0.32, y + 1.0, 0.15], [0, -0.9, 0]);
      poseRef.current = s.phase === "fall" ? floating : STAND;
      if (!finished.current && t > end + 0.6) {
        finished.current = true;
        onLive({ t, ride: s });
        onFinished();
      }
    },
    [ride, a, y0, end, mPerson, floating, onLive, onFinished],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={20} onSample={(t) => onLive({ t, ride: rideAt(ride, a, t) })} />
      <Building />
      <Rod ref={cable} radius={0.03} color="#a1a1aa" metal />
      <group ref={cab} position={[0, y0, 0]}>
        <ElevatorCab />
        <BathroomScale position={[0, 0, 0.1]} />
        <Person position={[0, 0.05, 0.1]} poseRef={poseRef} shirt="#0ea5e9" pants="#1e293b" />
        <SceneLabel position={[0.9, 2.75, 0]}>кабина лифта</SceneLabel>
      </group>
      <CameraFollow target={cab} axis="y" lead={1.3} min={0} max={BUILDING_H - 4} />
      <VectorArrow ref={aArrow} color="#f87171" />
      <VectorArrow ref={nArrow} color="#4ade80" />
      <VectorArrow ref={gArrow} color="#facc15" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* truck + trailer                                                      */
/* ------------------------------------------------------------------ */

interface TruckLive {
  t: number;
  x: number;
  v: number;
}

function SceneTruck({ F, m1, m2, running, speed, onLive, onFinished, simplified }: { F: number; m1: number; m2: number; running: boolean; speed: number; simplified: boolean; onLive: (n: TruckLive) => void; onFinished: () => void }) {
  // F in kN, masses in tonnes: a in m/s², tension in kN
  const a = F / (m1 + m2);
  const T = m2 * a;
  const truck = useRef<THREE.Group>(null!);
  const trailer = useRef<THREE.Group>(null!);
  const spin = useRef(0);
  const vArrow = useRef<VectorArrowHandle>(null);
  const aArrow = useRef<VectorArrowHandle>(null);
  const fArrow = useRef<VectorArrowHandle>(null);
  const tArrow = useRef<VectorArrowHandle>(null);
  const finished = useRef(false);
  const offset = TRUCK_COUPLING_X - TRAILER_KINGPIN_X;

  const handleFrame = useCallback(
    (t: number) => {
      const x = 0.5 * a * t * t;
      const v = a * t;
      if (truck.current) truck.current.position.x = x;
      if (trailer.current) trailer.current.position.x = x + offset;
      spin.current = x / 0.52;
      vArrow.current?.set([x + 1.2, 4.3, 0], [v * 0.25, 0, 0]);
      aArrow.current?.set([x + 1.2, 4.9, 0], [a * 2.2, 0, 0]);
      fArrow.current?.set([x - 1.6, 0.55, 1.5], [F * 0.09, 0, 0]);
      tArrow.current?.set([x + TRUCK_COUPLING_X - 0.9, 1.15, 1.35], [T * 0.09, 0, 0]);
      if (!finished.current && x > 140) {
        finished.current = true;
        onLive({ t, x, v });
        onFinished();
      }
    },
    [a, T, F, offset, onLive, onFinished],
  );

  const trees = useMemo(() => {
    const list: [number, number, number, number][] = [];
    for (let i = 0, x = -30; x < 190; i++, x += simplified ? 26 : 13) list.push([x, i % 2 ? -10 : -15, 5 + (i % 3), i]);
    return list;
  }, [simplified]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => onLive({ t, x: 0.5 * a * t * t, v: a * t })}
      />
      <Ground kind="grass" from={-40} to={200} width={60} tile={8} tileZ={8} y={-0.01} />
      <Ground kind="road" from={-40} to={200} width={8} tile={8} y={0.002} />
      {trees.map(([x, z, h, i]) => (
        <Tree key={i} position={[x, 0, z]} height={h} seed={i} conifer={i % 3 === 0} />
      ))}
      {[0, 20, 40, 60, 80, 100, 120, 140].map((d) => (
        <DistancePost key={d} text={`${d} м`} position={[d + 3, 0, -4.6]} />
      ))}
      <Truck ref={truck} spinRef={spin} />
      <Trailer ref={trailer} position={[offset, 0, 0]} spinRef={spin} />
      <CameraFollow target={truck} lead={-3} />
      <VectorArrow ref={vArrow} color="#4ade80" shaftRadius={0.06} headRadius={0.16} headLength={0.4} />
      <VectorArrow ref={aArrow} color="#f87171" shaftRadius={0.06} headRadius={0.16} headLength={0.4} />
      <VectorArrow ref={fArrow} color={F_COLOR} shaftRadius={0.07} headRadius={0.18} headLength={0.45} />
      <VectorArrow ref={tArrow} color={T_COLOR} shaftRadius={0.07} headRadius={0.18} headLength={0.45} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* two lab carts, same force                                           */
/* ------------------------------------------------------------------ */

interface CartsLive {
  t: number;
  x1: number;
  x2: number;
  v1: number;
  v2: number;
  [key: string]: number;
}

const loadFor = (m: number) => Math.max(0, Math.min(3, Math.round((m - 1) / 1.2)));

function SceneCarts({ F, m1, m2, running, speed, onLive, onFinished }: { F: number; m1: number; m2: number; running: boolean; speed: number; onLive: (n: CartsLive) => void; onFinished: () => void }) {
  const a1 = F / m1;
  const a2 = F / m2;
  const cart1 = useRef<THREE.Group>(null!);
  const cart2 = useRef<THREE.Group>(null!);
  const spin1 = useRef(0);
  const spin2 = useRef(0);
  const v1Arrow = useRef<VectorArrowHandle>(null);
  const v2Arrow = useRef<VectorArrowHandle>(null);
  const a1Arrow = useRef<VectorArrowHandle>(null);
  const a2Arrow = useRef<VectorArrowHandle>(null);
  const f1Arrow = useRef<VectorArrowHandle>(null);
  const f2Arrow = useRef<VectorArrowHandle>(null);
  const finished = useRef(false);
  const deck = 0.9;

  const handleFrame = useCallback(
    (t: number) => {
      const x1 = 0.5 * a1 * t * t;
      const x2 = 0.5 * a2 * t * t;
      if (cart1.current) cart1.current.position.x = x1;
      if (cart2.current) cart2.current.position.x = x2;
      spin1.current = x1 / 0.066;
      spin2.current = x2 / 0.066;
      v1Arrow.current?.set([x1, deck + 0.75, -0.55], [a1 * t * V_SCALE, 0, 0]);
      v2Arrow.current?.set([x2, deck + 0.75, 0.55], [a2 * t * V_SCALE, 0, 0]);
      a1Arrow.current?.set([x1, deck + 1.05, -0.55], [a1 * A_SCALE * 0.35, 0, 0]);
      a2Arrow.current?.set([x2, deck + 1.05, 0.55], [a2 * A_SCALE * 0.35, 0, 0]);
      f1Arrow.current?.set([x1 + 0.75, deck + 0.17, -0.55], [F * 0.06, 0, 0]);
      f2Arrow.current?.set([x2 + 0.75, deck + 0.17, 0.55], [F * 0.06, 0, 0]);
      if (!finished.current && Math.max(x1, x2) > TRACK_LEN - 1) {
        finished.current = true;
        onLive({ t, x1, x2, v1: a1 * t, v2: a2 * t });
        onFinished();
      }
    },
    [a1, a2, F, onLive, onFinished],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => onLive({ t, x1: 0.5 * a1 * t * t, x2: 0.5 * a2 * t * t, v1: a1 * t, v2: a2 * t })}
      />
      <Ground kind="tiles" from={-6} to={14} width={14} tile={3} tileZ={3} y={-0.01} />
      <LabBench position={[TRACK_LEN / 2 - 0.5, 0, 0]} length={TRACK_LEN + 3} depth={2} height={deck} />
      {[-0.55, 0.55].map((z) => (
        <mesh key={z} position={[TRACK_LEN / 2 - 0.5, deck + 0.01, z]}>
          <boxGeometry args={[TRACK_LEN + 2.6, 0.02, 0.5]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.35} />
        </mesh>
      ))}
      <group ref={cart1} position={[0, deck + 0.02, -0.55]}>
        <LabCart length={0.6} color="#7c6cf5" tag="1" load={loadFor(m1)} spinRef={spin1} />
        <Dynamometer position={[0.62, 0.17, 0]} length={0.45} stretch={F / 20} />
        <SceneLabel position={[0, 0.95, 0]} tone="#7c6cf5">{`m₁ = ${m1} кг`}</SceneLabel>
      </group>
      <group ref={cart2} position={[0, deck + 0.02, 0.55]}>
        <LabCart length={0.6} color="#f59e0b" tag="2" load={loadFor(m2)} spinRef={spin2} />
        <Dynamometer position={[0.62, 0.17, 0]} length={0.45} stretch={F / 20} />
        <SceneLabel position={[0, 0.95, 0]} tone="#f59e0b">{`m₂ = ${m2} кг`}</SceneLabel>
      </group>
      <VectorArrow ref={v1Arrow} color="#4ade80" />
      <VectorArrow ref={v2Arrow} color="#4ade80" />
      <VectorArrow ref={a1Arrow} color="#f87171" />
      <VectorArrow ref={a2Arrow} color="#f87171" />
      <VectorArrow ref={f1Arrow} color={F_COLOR} />
      <VectorArrow ref={f2Arrow} color={F_COLOR} />
    </>
  );
}

/* ------------------------------------------------------------------ */

type Scenario = "elevator" | "tractor" | "abstract";

const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function NewtonLawsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);
  const folder = "Второй закон Ньютона";

  const c = useControls(folder, {
    scenario: {
      value: "elevator",
      label: "Жизненный пример",
      options: { "Лифт: человек на весах": "elevator", "Тягач с прицепом": "tractor", "Две тележки: одна сила, разные массы": "abstract" },
    },
    ride: {
      value: "up",
      label: "поездка",
      options: { "Вверх: разгон — ход — торможение": "up", "Вниз: разгон — ход — торможение": "down", "Обрыв троса (невесомость)": "fall" },
      render: (get) => get(`${folder}.scenario`) === "elevator",
    },
    aElev: { value: 1.5, min: 0.5, max: 3, step: 0.1, label: "ускорение лифта, м/с²", render: (get) => get(`${folder}.scenario`) === "elevator" && get(`${folder}.ride`) !== "fall" },
    mPerson: { value: 70, min: 30, max: 120, step: 1, label: "m пассажира, кг", render: (get) => get(`${folder}.scenario`) === "elevator" },
    Ftr: { value: 20, min: 5, max: 40, step: 1, label: "сила тяги F, кН", render: (get) => get(`${folder}.scenario`) === "tractor" },
    mTruck: { value: 8, min: 5, max: 12, step: 0.5, label: "масса тягача m₁, т", render: (get) => get(`${folder}.scenario`) === "tractor" },
    mTrailer: { value: 16, min: 2, max: 30, step: 1, label: "масса прицепа m₂, т", render: (get) => get(`${folder}.scenario`) === "tractor" },
    F: { value: 10, min: 1, max: 20, step: 0.5, label: "F, Н (одинаковая)", render: (get) => get(`${folder}.scenario`) === "abstract" },
    m1: { value: 2, min: 0.5, max: 5, step: 0.1, label: "m₁, кг (тележка 1)", render: (get) => get(`${folder}.scenario`) === "abstract" },
    m2: { value: 4, min: 0.5, max: 5, step: 0.1, label: "m₂, кг (тележка 2)", render: (get) => get(`${folder}.scenario`) === "abstract" },
  });
  const scenario = c.scenario as Scenario;
  const ride = c.ride as Ride;

  const runKey = `${clock.resetNonce}|${scenario}|${ride}|${c.aElev}|${c.mPerson}|${c.Ftr}|${c.mTruck}|${c.mTrailer}|${c.F}|${c.m1}|${c.m2}`;

  const [elev, setElev] = useState<ElevatorLive>({ t: 0, ride: rideAt(ride, c.aElev, 0) });
  const [elevSeries, setElevSeries] = useState<{ t: number; kg: number; [key: string]: number }[]>([]);
  const [truck, setTruck] = useState<TruckLive>({ t: 0, x: 0, v: 0 });
  const [truckSeries, setTruckSeries] = useState<{ t: number; v: number; [key: string]: number }[]>([]);
  const [carts, setCarts] = useState<CartsLive>({ t: 0, x1: 0, x2: 0, v1: 0, v2: 0 });
  const [cartSeries, setCartSeries] = useState<{ t: number; x1: number; x2: number; v1: number; v2: number; [key: string]: number }[]>([]);

  const play = clock.play;
  useEffect(() => {
    const start = rideAt(ride, c.aElev, 0);
    setElev({ t: 0, ride: start });
    setElevSeries([{ t: 0, kg: c.mPerson * (1 + start.acc / G) }]);
    setTruck({ t: 0, x: 0, v: 0 });
    setTruckSeries([{ t: 0, v: 0 }]);
    setCarts({ t: 0, x1: 0, x2: 0, v1: 0, v2: 0 });
    setCartSeries([{ t: 0, x1: 0, x2: 0, v1: 0, v2: 0 }]);
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const mPerson = c.mPerson;
  const handleElev = useCallback(
    (n: ElevatorLive) => {
      setElev(n);
      setElevSeries((prev) => (prev.length > 500 ? prev : [...prev, { t: n.t, kg: Math.max(0, mPerson * (1 + n.ride.acc / G)) }]));
    },
    [mPerson],
  );
  const handleTruck = useCallback((n: TruckLive) => {
    setTruck(n);
    setTruckSeries((prev) => (prev.length > 500 ? prev : [...prev, { t: n.t, v: n.v * 3.6 }]));
  }, []);
  const handleCarts = useCallback((n: CartsLive) => {
    setCarts(n);
    setCartSeries((prev) => (prev.length > 500 ? prev : [...prev, { ...n }]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  // elevator numbers
  const N = Math.max(0, mPerson * (G + elev.ride.acc));
  const kg = N / G;
  // truck numbers
  const aTruck = c.Ftr / (c.mTruck + c.mTrailer);
  const tension = c.mTrailer * aTruck;
  // carts
  const a1 = c.F / c.m1;
  const a2 = c.F / c.m2;

  let caption;
  let legend: LegendItem[];
  let numbers;
  let graph;
  let note;
  if (scenario === "elevator") {
    const p = elev.ride.phase;
    const dirWord = ride === "down" ? "вниз" : "вверх";
    caption =
      p === "accel" ? (
        <><b>Лифт разгоняется {dirWord}.</b> {ride === "up" ? "Пол «подпирает» пассажира сильнее обычного" : "Пол «уходит из-под ног»"} — весы показывают <b>{f1(kg)} кг</b> вместо {mPerson}.</>
      ) : p === "cruise" ? (
        <><b>Едет равномерно</b> со скоростью {f1(Math.abs(elev.ride.v))} м/с. Ускорения нет — весы показывают обычные <b>{mPerson} кг</b>, как на земле.</>
      ) : p === "brake" ? (
        <><b>Лифт тормозит.</b> Ускорение направлено {ride === "up" ? "вниз" : "вверх"} — весы показывают <b>{f1(kg)} кг</b>.</>
      ) : p === "fall" ? (
        <><b>Трос оборвался!</b> Кабина и пассажир падают вместе с ускорением g — весам не на что давить: <b>0 кг, невесомость</b>.</>
      ) : p === "catch" ? (
        <><b>Сработали аварийные ловители:</b> торможение {CATCH_A} м/с² — весы показывают <b>{f1(kg)} кг</b>, в {f1(kg / mPerson)} раза больше обычного.</>
      ) : (
        <>Лифт остановился. Весы снова показывают <b>{mPerson} кг</b>: N = mg, когда ускорения нет.</>
      );
    legend = [
      { color: "#4ade80", label: "N — сила давления весов" },
      { color: "#facc15", label: "mg — сила тяжести" },
      { color: "#f87171", label: "a — ускорение лифта" },
    ];
    numbers = [
      { label: "Время t", value: elev.t.toFixed(2), unit: "с" },
      { label: "Скорость лифта v", value: elev.ride.v.toFixed(2), unit: "м/с" },
      { label: "Ускорение a", value: elev.ride.acc.toFixed(1), unit: "м/с²", color: "#f87171" },
      { label: "Весы показывают", value: kg.toFixed(1), unit: "кг", color: kg < mPerson * 0.15 ? "#f87171" : "#4ade80" },
      { label: "Показания весов N", value: N.toFixed(0), unit: "Н" },
      { label: "N/mg", value: (N / (mPerson * G)).toFixed(2), unit: "×" },
    ];
    graph = (
      <div className="rounded-xl border border-border bg-surface-2/60 p-3">
        <p className="mb-1 px-1 text-xs font-medium text-muted-2">Показания весов во время поездки, кг</p>
        <LiveChart data={elevSeries} xKey="t" xLabel="t, с" series={[{ key: "kg", color: "#4ade80", label: "весы, кг" }]} />
      </div>
    );
    note = (
      <>
        Второй закон Ньютона для пассажира: N − mg = ma, откуда N = m(g + a). Весы измеряют именно N — силу, с которой они
        давят на человека. При ускорении вверх они показывают больше, при ускорении вниз — меньше, а при свободном падении
        (a = −g) — ноль. «Масса» на табло — это N/g: настоящая масса человека при этом не меняется.
      </>
    );
  } else if (scenario === "tractor") {
    caption = (
      <>
        Двигатель тянет с силой <b>F = {c.Ftr} кН</b>. Прицеп сам не едет — его тянет сцепка с силой <b style={{ color: T_COLOR }}>T = m₂a = {f1(tension)} кН</b>. Оба разгоняются
        одинаково: a = F/(m₁+m₂) = {f2(aTruck)} м/с². Без прицепа было бы {f2(c.Ftr / c.mTruck)} м/с².
      </>
    );
    legend = [
      { color: F_COLOR, label: "F — тяга двигателя" },
      { color: T_COLOR, label: "T — натяжение сцепки" },
      { color: "#f87171", label: "ускорение a" },
      { color: "#4ade80", label: "скорость v" },
    ];
    numbers = [
      { label: "Время t", value: truck.t.toFixed(2), unit: "с" },
      { label: "a = F/(m₁+m₂)", value: aTruck.toFixed(2), unit: "м/с²", color: "#f87171" },
      { label: "Скорость v", value: (truck.v * 3.6).toFixed(0), unit: "км/ч", color: "#4ade80" },
      { label: "Натяжение сцепки T", value: tension.toFixed(1), unit: "кН", color: T_COLOR },
      { label: "Сила тяги F", value: c.Ftr.toFixed(0), unit: "кН", color: F_COLOR },
      { label: "Пройдено", value: truck.x.toFixed(0), unit: "м" },
    ];
    graph = (
      <div className="rounded-xl border border-border bg-surface-2/60 p-3">
        <p className="mb-1 px-1 text-xs font-medium text-muted-2">v(t) — скорость автопоезда, км/ч</p>
        <LiveChart data={truckSeries} xKey="t" xLabel="t, с" series={[{ key: "v", color: "#4ade80", label: "v, км/ч" }]} />
      </div>
    );
    note = (
      <>
        Тягач и прицеп соединены сцепкой и движутся как одно тело с ускорением a = F/(m₁+m₂). Сила тяги приложена только к
        тягачу, а на прицеп действует лишь натяжение сцепки T = m₂a. Чем тяжелее груз, тем медленнее разгон — поэтому гружёные
        фуры так долго набирают скорость. Сопротивление движению здесь не учитывается.
      </>
    );
  } else {
    caption = (
      <>
        Обе тележки тянут с одной и той же силой <b>F = {c.F} Н</b> — динамометры показывают одинаково. Лёгкая разгоняется быстрее: a₁ = {f2(a1)} м/с², гружёная — медленнее:
        a₂ = {f2(a2)} м/с². Во сколько раз больше масса, во столько раз меньше ускорение.
      </>
    );
    legend = [
      { color: F_COLOR, label: "сила F (одинаковая)" },
      { color: "#f87171", label: "ускорение a" },
      { color: "#4ade80", label: "скорость v" },
    ];
    numbers = [
      { label: "Время t", value: carts.t.toFixed(2), unit: "с" },
      { label: "a₁ = F/m₁", value: a1.toFixed(2), unit: "м/с²", color: "#f87171" },
      { label: "a₂ = F/m₂", value: a2.toFixed(2), unit: "м/с²", color: "#f87171" },
      { label: "v₁", value: carts.v1.toFixed(2), unit: "м/с", color: "#4ade80" },
      { label: "v₂", value: carts.v2.toFixed(2), unit: "м/с", color: "#4ade80" },
      { label: "Отношение a₁/a₂", value: (a1 / a2).toFixed(2), unit: "= m₂/m₁" },
    ];
    graph = (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">x(t) — путь тележек</p>
          <LiveChart data={cartSeries} xKey="t" xLabel="t, с" series={[{ key: "x1", color: "#7c6cf5", label: "x₁, м" }, { key: "x2", color: "#f59e0b", label: "x₂, м" }]} />
        </div>
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">v(t) — скорость тележек</p>
          <LiveChart data={cartSeries} xKey="t" xLabel="t, с" series={[{ key: "v1", color: "#7c6cf5", label: "v₁, м/с" }, { key: "v2", color: "#f59e0b", label: "v₂, м/с" }]} />
        </div>
      </div>
    );
    note = (
      <>
        Второй закон Ньютона: a = F/m. Одна и та же сила разгоняет тело тем сильнее, чем меньше его масса. Тележки стартуют
        из покоя, поэтому x(t) = ½at² и v(t) = at. Трение колёс не учитывается.
      </>
    );
  }

  const stage =
    scenario === "elevator"
      ? { camera: [4.2, START_Y[ride] + 2.6, 8.5] as [number, number, number], target: [0, START_Y[ride] + 1.3, 0] as [number, number, number], max: 24, fog: [16, 50] as [number, number] }
      : scenario === "tractor"
        ? { camera: [-6, 7, 20] as [number, number, number], target: [-3, 1.8, 0] as [number, number, number], max: 60, fog: [30, 90] as [number, number] }
        : { camera: [3, 3.4, 6.5] as [number, number, number], target: [3, 0.9, 0] as [number, number, number], max: 22, fog: [14, 40] as [number, number] };

  return (
    <SimShell
      scene={
        <SceneCanvas key={`${scenario}-${ride}`} camera={{ position: stage.camera, fov: 50 }} orbitTarget={stage.target} simplified={isMobile} maxDistance={stage.max} minDistance={3} bloomThreshold={0.6} fogRange={stage.fog}>
          {scenario === "elevator" ? (
            <SceneElevator key={runKey} ride={ride} a={c.aElev} mPerson={mPerson} running={clock.running} speed={clock.speed} onLive={handleElev} onFinished={handleFinished} />
          ) : scenario === "tractor" ? (
            <SceneTruck key={runKey} F={c.Ftr} m1={c.mTruck} m2={c.mTrailer} running={clock.running} speed={clock.speed} simplified={isMobile} onLive={handleTruck} onFinished={handleFinished} />
          ) : (
            <SceneCarts key={runKey} F={c.F} m1={c.m1} m2={c.m2} running={clock.running} speed={clock.speed} onLive={handleCarts} onFinished={handleFinished} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={<NumberReadouts items={numbers} />}
      graphs={graph}
      note={note}
    />
  );
}
