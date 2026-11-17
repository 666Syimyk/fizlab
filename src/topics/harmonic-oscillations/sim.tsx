import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
import { EnergyBars } from "@/components/sim/EnergyBars";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { HangingWeight, Rod, SwingFrame, type RodHandle } from "@/components/sim/props/mechanics";
import { SteelBall } from "@/components/sim/props/sport";
import { Car, Wheel } from "@/components/sim/props/vehicles";
import { Person } from "@/components/sim/props/Person";
import { SIT, pose } from "@/components/sim/props/pose";
import { Ground, RetortStand, Tree } from "@/components/sim/props/environment";
import { woodTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const G = 9.8;
const SPRING_X = -2.2;
const PEND_X = 1.6;
const SPRING_COLOR = "#a78bfa";
const PEND_COLOR = "#5eead4";

// x(t) = A cos(wt) ; v(t) = -A w sin(wt)
function shm(A: number, w: number, t: number) {
  return { x: A * Math.cos(w * t), v: -A * w * Math.sin(w * t) };
}

interface SamplePoint {
  t: number;
  xs: number;
  xp: number;
  [key: string]: number;
}

interface LiveNumbers {
  t: number;
  xs: number;
  vs: number;
  thetaDeg: number;
  vp: number;
  ekS: number;
  epS: number;
  eTotalS: number;
  ekP: number;
  epP: number;
  eTotalP: number;
}

type Scenario = "abstract" | "swing" | "car";

interface SceneContentProps {
  scenario: Scenario;
  m: number;
  k: number;
  l: number;
  A: number;
  theta0Deg: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/** playground spring rider: a coil spring from a base plate up to a little horse */
function SpringRider({ seat, kid }: { seat: RefObject<THREE.Group | null>; kid: boolean }) {
  return (
    <group ref={seat}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <capsuleGeometry args={[0.16, 0.55, 6, 12]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.45} />
      </mesh>
      <mesh position={[0.42, 0.34, 0]} rotation={[0, 0, -0.5]} castShadow>
        <capsuleGeometry args={[0.1, 0.22, 6, 10]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.45} />
      </mesh>
      <mesh position={[0.5, 0.5, 0]} castShadow>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.45} />
      </mesh>
      <mesh position={[0.3, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.42, 8]} />
        <meshStandardMaterial color="#ef4444" roughness={0.5} />
      </mesh>
      {kid && <Person position={[-0.05, -0.52, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.58} pose={pose({ ...SIT, shoulderL: 1.2, shoulderR: 1.2, elbowL: 0.6, elbowR: 0.6 })} shirt="#22c55e" pants="#1e3a8a" />}
    </group>
  );
}

function SceneContent({ scenario, m, k, l, A, theta0Deg, running, speed, onSample, onLive }: SceneContentProps) {
  const omegaS = Math.sqrt(k / m);
  const omegaP = Math.sqrt(G / l);
  const theta0 = (theta0Deg * Math.PI) / 180;
  const lab = scenario === "abstract";
  const playground = scenario === "swing";
  const car = scenario === "car";

  // spring oscillator geometry (vertical in every scenario)
  const standH = 2.6;
  const tipX = SPRING_X + 0.55;
  const tipY = standH - 0.03;
  const L_EQ = 1.15;
  const riderY0 = 0.95;
  const carY0 = 0;

  const spring = useRef<THREE.Group>(null!);
  const weight = useRef<THREE.Group>(null!);
  const rider = useRef<THREE.Group>(null!);
  const riderSpring = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const carSprings = useRef<(THREE.Group | null)[]>([]);
  const swing = useRef<THREE.Group>(null!);
  const ball = useRef<THREE.Group>(null!);
  const thread = useRef<RodHandle>(null);

  const pivotY = playground ? l + 0.75 : l + 0.6;

  const compute = useCallback(
    (t: number) => {
      const s = shm(A, omegaS, t);
      const p = shm(theta0, omegaP, t);
      return { xs: s.x, vs: s.v, theta: p.x, thetaDot: p.v };
    },
    [A, omegaS, theta0, omegaP],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const { xs, theta } = compute(t);
      if (lab) {
        // x > 0: the weight is pulled down, the spring is longer
        const len = L_EQ + xs;
        if (spring.current) spring.current.scale.x = len;
        if (weight.current) weight.current.position.set(tipX, tipY - len, 0);
      }
      if (playground) {
        if (rider.current) rider.current.position.set(SPRING_X, riderY0 - xs, 0);
        if (riderSpring.current) riderSpring.current.scale.x = riderY0 - 0.25 - xs;
      }
      if (car) {
        if (body.current) body.current.position.y = carY0 - xs;
        carSprings.current.forEach((g) => {
          if (g) g.scale.x = 0.42 - xs;
        });
      }
      if (!car) {
        if (playground) {
          if (swing.current) swing.current.rotation.z = theta;
        } else {
          const bx = PEND_X + l * Math.sin(theta);
          const by = pivotY - l * Math.cos(theta);
          if (ball.current) ball.current.position.set(bx, by, 0);
          thread.current?.set([PEND_X, pivotY, 0], [bx, by + 0.12, 0]);
        }
      }
    },
    [compute, lab, playground, car, tipX, tipY, l, pivotY],
  );

  const wood = woodTexture("light", 2);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const { xs, vs, theta, thetaDot } = compute(t);
          const xp = l * theta;
          const vp = l * thetaDot;
          onSample({ t, xs, xp });
          onLive({
            t,
            xs,
            vs,
            thetaDeg: (theta * 180) / Math.PI,
            vp,
            ekS: 0.5 * m * vs * vs,
            epS: 0.5 * k * xs * xs,
            eTotalS: 0.5 * k * A * A,
            ekP: 0.5 * m * vp * vp,
            epP: 0.5 * m * G * l * theta * theta,
            eTotalP: 0.5 * m * G * l * theta0 * theta0,
          });
        }}
      />

      {lab && (
        <>
          <Ground kind="tiles" from={-6} to={6} width={8} tile={2} tileZ={2} y={-0.01} />
          <RetortStand position={[SPRING_X, 0, 0]} height={standH} armLength={0.7} />
          {/* the unit coil is rotated so it hangs straight down from the arm */}
          <group position={[tipX, tipY, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <SpringCoil ref={spring} color={SPRING_COLOR} loops={14} radius={0.1} />
          </group>
          <group ref={weight} position={[tipX, tipY - L_EQ, 0]}>
            <HangingWeight height={0.36} radius={0.13} label={`${m} кг`} />
          </group>
          <SceneLabel position={[SPRING_X - 0.5, standH + 0.3, 0]} tone={SPRING_COLOR}>груз на пружине</SceneLabel>
          <RetortStand position={[PEND_X - 0.45, 0, -0.25]} height={pivotY + 0.03} armLength={0.6} />
          <Rod ref={thread} radius={0.006} color="#e5e7eb" />
          <group ref={ball}>
            <SteelBall radius={0.12} />
          </group>
          <SceneLabel position={[PEND_X, pivotY + 0.35, 0]} tone={PEND_COLOR}>маятник: шарик на нити</SceneLabel>
        </>
      )}

      {playground && (
        <>
          <Ground kind="grass" from={-8} to={8} width={10} tile={4} tileZ={4} y={-0.01} />
          <Tree position={[-5, 0, -4]} height={5} seed={3} />
          <Tree position={[5.5, 0, -4.5]} height={4.5} seed={8} conifer />
          {/* spring rider */}
          <mesh position={[SPRING_X, 0.03, 0]}>
            <cylinderGeometry args={[0.3, 0.34, 0.06, 20]} />
            <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
          </mesh>
          <group position={[SPRING_X, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
            <SpringCoil ref={riderSpring} color="#94a3b8" loops={8} radius={0.16} />
          </group>
          <SpringRider seat={rider} kid />
          <SceneLabel position={[SPRING_X, 2.0, 0]} tone={SPRING_COLOR}>качалка на пружине</SceneLabel>
          {/* swing */}
          <SwingFrame position={[PEND_X, 0, 0]} height={pivotY} span={1.2} />
          <group ref={swing} position={[PEND_X, pivotY, 0]}>
            {[-0.24, 0.24].map((z) => (
              <mesh key={z} position={[0, -l / 2, z]}>
                <cylinderGeometry args={[0.012, 0.012, l, 6]} />
                <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
              </mesh>
            ))}
            <mesh position={[0, -l, 0]} castShadow>
              <boxGeometry args={[0.32, 0.04, 0.6]} />
              <meshStandardMaterial map={wood} roughness={0.8} />
            </mesh>
            <Person position={[-0.04, -l - 0.5, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.6} pose={pose({ ...SIT, shoulderL: 2.6, shoulderR: 2.6, elbowL: 0.3, elbowR: 0.3 })} shirt="#ec4899" pants="#312e81" longHair hair="#7c2d12" />
          </group>
          <SceneLabel position={[PEND_X, pivotY + 0.45, 0]} tone={PEND_COLOR}>качели</SceneLabel>
        </>
      )}

      {car && (
        <>
          <Ground kind="asphalt" from={-10} to={10} width={8} tile={4} tileZ={4} y={-0.01} />
          {/* speed bump the car has just driven over */}
          <mesh position={[-3.6, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 3.2, 16, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color="#facc15" roughness={0.6} />
          </mesh>
          <SceneLabel position={[-3.6, 0.5, 1.8]}>кочка («лежачий полицейский»)</SceneLabel>
          {[
            [1.38, 0.8],
            [-1.38, 0.8],
            [1.38, -0.8],
            [-1.38, -0.8],
          ].map(([x, z], i) => (
            <group key={i}>
              <Wheel radius={0.34} width={0.26} position={[x, 0.34, z]} side={z > 0 ? 1 : -1} />
              <group position={[x, 0.34, z * 1.28]} rotation={[0, 0, Math.PI / 2]}>
                <SpringCoil
                  ref={(g) => {
                    carSprings.current[i] = g;
                  }}
                  color="#f97316"
                  loops={6}
                  radius={0.09}
                />
              </group>
            </group>
          ))}
          <group ref={body}>
            <Car wheels={false} color="#2563eb" />
          </group>
          <SceneLabel position={[0, 2.0, 0]} tone={SPRING_COLOR}>кузов качается на пружинах подвески</SceneLabel>
        </>
      )}
    </>
  );
}

const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function HarmonicOscillationsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario: scenarioRaw, m, k, l, A, theta0 } = useControls("Колебания", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Лаборатория: пружина и маятник": "abstract", "Детская площадка: качалка и качели": "swing", "Автомобиль на рессорах": "car" },
    },
    m: { value: 1, min: 0.2, max: 3, step: 0.1, label: "m, кг" },
    k: { value: 40, min: 5, max: 100, step: 1, label: "k, Н/м (пружина)" },
    l: { value: 1, min: 0.3, max: 2.2, step: 0.1, label: "l, м (маятник)", render: (get) => get("Колебания.scenario") !== "car" },
    A: { value: 0.2, min: 0.05, max: 0.4, step: 0.01, label: "A, м (амплитуда пружины)" },
    theta0: { value: 12, min: 2, max: 18, step: 1, label: "θ₀, ° (амплитуда маятника)", render: (get) => get("Колебания.scenario") !== "car" },
  });
  const scenario = scenarioRaw as Scenario;
  const car = scenario === "car";

  const omegaS = Math.sqrt(k / m);
  const omegaP = Math.sqrt(G / l);
  const periodS = (2 * Math.PI) / omegaS;
  const periodP = (2 * Math.PI) / omegaP;

  const theta0rad = (theta0 * Math.PI) / 180;
  const initialLive: LiveNumbers = {
    t: 0,
    xs: A,
    vs: 0,
    thetaDeg: theta0,
    vp: 0,
    ekS: 0,
    epS: 0.5 * k * A * A,
    eTotalS: 0.5 * k * A * A,
    ekP: 0,
    epP: 0.5 * m * G * l * theta0rad ** 2,
    eTotalP: 0.5 * m * G * l * theta0rad ** 2,
  };
  const [live, setLive] = useState<LiveNumbers>(initialLive);
  const [series, setSeries] = useState<SamplePoint[]>([]);

  const runKey = `${clock.resetNonce}|${scenario}|${m}|${k}|${l}|${A}|${theta0}`;
  const play = clock.play;
  useEffect(() => {
    setLive(initialLive);
    setSeries([{ t: 0, xs: A, xp: l * theta0rad }]);
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const caption =
    scenario === "swing" ? (
      <>
        <b>Качели</b> — маятник: период T = 2π√(l/g) = {f2(periodP)} с зависит только от длины подвеса, а не от веса ребёнка. <b>Качалка на пружине</b> — наоборот: T = 2π√(m/k) = {f2(periodS)} с, и
        тяжёлый ребёнок качается медленнее.
      </>
    ) : car ? (
      <>
        Машина переехала кочку, и кузов закачался на пружинах подвески: T = 2π√(m/k) = {f2(periodS)} с (около одного качания в секунду — так подвеску настраивают для комфорта).
        Загруженная машина качается медленнее, а амортизаторы гасят раскачку.
      </>
    ) : (
      <>
        Груз на пружине: T = 2π√(m/k) = {f2(periodS)} с, шарик на нити: T = 2π√(l/g) = {f2(periodP)} с. В крайних точках скорость ноль и вся энергия потенциальная, в середине —
        скорость наибольшая. Период не зависит от размаха колебаний.
      </>
    );
  const legend: LegendItem[] = car
    ? [{ color: SPRING_COLOR, label: "пружинный маятник (кузов)", kind: "line" }]
    : [
        { color: SPRING_COLOR, label: scenario === "swing" ? "качалка на пружине" : "груз на пружине", kind: "line" },
        { color: PEND_COLOR, label: scenario === "swing" ? "качели (маятник)" : "маятник", kind: "line" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={car ? { position: [2.5, 2.2, 7.5], fov: 50 } : { position: [-0.3, 2.0, 7.4], fov: 50 }}
          orbitTarget={car ? [0, 0.8, 0] : [-0.3, 1.3, 0]}
          simplified={isMobile}
          maxDistance={30}
          minDistance={3}
          bloomThreshold={0.6}
          fogRange={[14, 40]}
        >
          <SceneContent
            key={runKey}
            scenario={scenario}
            m={m}
            k={k}
            l={l}
            A={A}
            theta0Deg={theta0}
            running={clock.running}
            speed={clock.speed}
            onSample={handleSample}
            onLive={setLive}
          />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        <div className="flex flex-col gap-4">
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: car ? "смещение кузова x" : "x пружины", value: live.xs.toFixed(3), unit: "м", color: SPRING_COLOR },
              { label: "Tₛ = 2π√(m/k)", value: periodS.toFixed(2), unit: "с" },
              ...(car
                ? [{ label: "Частота f = 1/T", value: (1 / periodS).toFixed(2), unit: "Гц" }]
                : [
                    { label: "θ маятника", value: live.thetaDeg.toFixed(1), unit: "°", color: PEND_COLOR },
                    { label: "Tₚ = 2π√(l/g)", value: periodP.toFixed(2), unit: "с" },
                  ]),
            ]}
          />
          <EnergyBars label={car ? "Энергия колебаний кузова" : "Энергия пружинного маятника"} kinetic={live.ekS} potential={live.epS} total={live.eTotalS} />
          {!car && <EnergyBars label="Энергия математического маятника" kinetic={live.ekP} potential={live.epP} total={live.eTotalP} />}
        </div>
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">x(t) — смещение</p>
          <LiveChart
            data={series}
            xKey="t"
            xLabel="t, с"
            series={car ? [{ key: "xs", color: SPRING_COLOR, label: "кузов, м" }] : [{ key: "xs", color: SPRING_COLOR, label: "пружина, м" }, { key: "xp", color: PEND_COLOR, label: "маятник (дуга), м" }]}
          />
        </div>
      }
      note={
        scenario === "swing" ? (
          <>
            Качели — математический маятник: период T = 2π√(l/g) зависит ТОЛЬКО от длины подвеса l (и g), но не от массы ребёнка.
            Именно поэтому часы с маятником идут точно: важна только длина. Качалка на пружине — пружинный маятник, у неё
            T = 2π√(m/k): чем тяжелее седок, тем медленнее качание.
          </>
        ) : car ? (
          <>
            Кузов на пружинах подвески — пружинный маятник: после кочки автомобиль колеблется с частотой ω = √(k/m). Жёсткость
            пружин k и масса кузова m определяют, насколько «мягко» или «жёстко» едет машина. Здесь масса и жёсткость даны «на
            одно колесо в уменьшенном масштабе» — частота при этом та же. Затухание (амортизаторы) — в теме «Затухающие колебания».
          </>
        ) : (
          <>
            x(t) = A·cos(ωt), ω = √(k/m) для пружины и ω = √(g/l) для математического маятника (приближение малых углов,
            θ₀ ≤ 18°). Полная энергия E = ½kA² (пружина) и E = ½mglθ₀² (маятник) сохраняется — кинетическая и потенциальная
            части перетекают друг в друга.
          </>
        )
      }
    />
  );
}
