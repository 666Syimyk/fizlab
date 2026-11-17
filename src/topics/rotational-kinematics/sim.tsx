import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { Trail } from "@react-three/drei";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { CameraFollow } from "@/components/sim/CameraFollow";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { BicycleWheel } from "@/components/sim/props/mechanics";
import { Person } from "@/components/sim/props/Person";
import { pose } from "@/components/sim/props/pose";
import { Ground, Tree } from "@/components/sim/props/environment";
import { carouselTexture, vinylTexture, woodTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const V_SCALE = 0.3;
const A_SCALE = 0.12;
const KID_RADII = [0.95, 0.62, 0.3];
const KID_COLORS = ["#4ade80", "#22d3ee", "#facc15"];

// phi(t) = phi0 + w0 t + 1/2 e t^2 ; w(t) = w0 + e t
function phiAt(w0: number, e: number, t: number) {
  return w0 * t + 0.5 * e * t * t;
}
function omegaAt(w0: number, e: number, t: number) {
  return w0 + e * t;
}

type Scenario = "abstract" | "wheel" | "carousel";

interface SamplePoint {
  t: number;
  phi: number;
  omega: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  phi: number;
  omega: number;
  v: number;
  aTotal: number;
  /** wheel: speed of the tyre mark in the ground frame */
  vMark: number;
}

function liveAt(w0: number, eps: number, R: number, t: number): LiveNumbers {
  const phi = phiAt(w0, eps, t);
  const omega = omegaAt(w0, eps, t);
  return {
    t,
    phi,
    omega,
    v: omega * R,
    aTotal: Math.hypot(omega * omega * R, eps * R),
    vMark: Math.abs(omega * R) * Math.sqrt(2 - 2 * Math.cos(phi)),
  };
}

/* ---------------- objects ---------------- */

function Turntable({ R }: { R: number }) {
  const wood = woodTexture("dark", 3);
  return (
    <group>
      <mesh position={[0.25 * R, -0.16 * R, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.7 * R, 0.3 * R, 2.35 * R]} />
        <meshStandardMaterial map={wood} roughness={0.6} />
      </mesh>
      <mesh position={[0.25 * R, -0.005, 0]}>
        <boxGeometry args={[2.66 * R, 0.01, 2.31 * R]} />
        <meshStandardMaterial color="#1f1f23" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* tonearm */}
      <group position={[1.3 * R, 0.02, -0.85 * R]}>
        <mesh position={[0, 0.06 * R, 0]}>
          <cylinderGeometry args={[0.1 * R, 0.12 * R, 0.12 * R, 20]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
        </mesh>
        <mesh position={[-0.3 * R, 0.14 * R, 0.45 * R]} rotation={[0, 0.58, Math.PI / 2]}>
          <cylinderGeometry args={[0.018 * R, 0.018 * R, 1.1 * R, 10]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>
      {/* platter */}
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[1.03 * R, 1.03 * R, 0.06, 64]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.85} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** static parts of the playground carousel (the deck and the children rotate in the scene) */
function CarouselBase() {
  return (
    <group>
      <Ground kind="grass" from={-12} to={12} width={24} tile={6} tileZ={6} y={-0.01} />
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.7, 0.24, 24]} />
        <meshStandardMaterial color="#52525b" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 1.7, 12]} />
        <meshStandardMaterial color="#e5e7eb" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 2.0, 0]} castShadow>
        <coneGeometry args={[0.35, 0.3, 16]} />
        <meshStandardMaterial color="#ef4444" roughness={0.5} />
      </mesh>
    </group>
  );
}

function WheelRoad() {
  return (
    <group>
      <Ground kind="grass" from={-12} to={24} width={22} tile={6} tileZ={6} y={-0.012} />
      <Ground kind="road" from={-12} to={24} width={4} tile={6} y={0} />
      {[
        [-6, -6, 4.5],
        [4, -7, 5.5],
        [13, -6.5, 4.8],
        [20, -7.2, 5.2],
      ].map(([x, z, h], i) => (
        <Tree key={i} position={[x, 0, z]} height={h} seed={i + 9} conifer={i % 2 === 1} />
      ))}
    </group>
  );
}

/* ---------------- scene ---------------- */

interface SceneContentProps {
  scenario: Scenario;
  w0: number;
  eps: number;
  R: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onFinished: () => void;
}

function SceneContent({ scenario, w0, eps, R, running, speed, onSample, onLive, onFinished }: SceneContentProps) {
  const spinGroup = useRef<THREE.Group>(null!);
  const hub = useRef<THREE.Group>(null!);
  const mark = useRef<THREE.Mesh>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const aArrow = useRef<VectorArrowHandle>(null);
  const cArrow = useRef<VectorArrowHandle>(null);
  const kidArrows = [useRef<VectorArrowHandle>(null), useRef<VectorArrowHandle>(null), useRef<VectorArrowHandle>(null)];
  const finishedRef = useRef(false);
  const deckTex = useMemo(() => carouselTexture(), []);
  const vinyl = useMemo(() => vinylTexture(), []);

  const handleFrame = useCallback(
    (t: number) => {
      const phi = phiAt(w0, eps, t);
      const omega = omegaAt(w0, eps, t);

      if (scenario === "wheel") {
        const cx = R * phi;
        if (hub.current) hub.current.position.x = cx;
        if (spinGroup.current) spinGroup.current.rotation.z = -phi;
        // tyre mark: starts at the contact point, traces a cycloid
        const mx = cx - R * Math.sin(phi);
        const my = R - R * Math.cos(phi);
        const vx = omega * R * (1 - Math.cos(phi));
        const vy = omega * R * Math.sin(phi);
        const ax = eps * R * (1 - Math.cos(phi)) + omega * omega * R * Math.sin(phi);
        const ay = eps * R * Math.sin(phi) + omega * omega * R * Math.cos(phi);
        vArrow.current?.set([mx, my, 0.25], [vx * V_SCALE, vy * V_SCALE, 0]);
        aArrow.current?.set([mx, my, 0.3], [ax * A_SCALE, ay * A_SCALE, 0]);
        cArrow.current?.set([cx, R, 0.3], [omega * R * V_SCALE, 0, 0]);
        if (!finishedRef.current && Math.abs(cx) > 11) {
          finishedRef.current = true;
          onLive(liveAt(w0, eps, R, t));
          onFinished();
        }
        return;
      }

      if (spinGroup.current) spinGroup.current.rotation.y = -phi;
      const tx = -Math.sin(phi);
      const tz = Math.cos(phi);
      if (scenario === "carousel") {
        KID_RADII.forEach((k, i) => {
          const r = k * R;
          kidArrows[i].current?.set([r * Math.cos(phi), 1.15, r * Math.sin(phi)], [tx * omega * r * V_SCALE, 0, tz * omega * r * V_SCALE]);
        });
        return;
      }
      const mx = R * Math.cos(phi);
      const mz = R * Math.sin(phi);
      const v = omega * R;
      vArrow.current?.set([mx, 0.12, mz], [tx * v * V_SCALE, 0, tz * v * V_SCALE]);
      const aN = omega * omega * R;
      const aTau = eps * R;
      aArrow.current?.set([mx, 0.12, mz], [(-Math.cos(phi) * aN + tx * aTau) * A_SCALE, 0, (-Math.sin(phi) * aN + tz * aTau) * A_SCALE]);
    },
    // kidArrows are stable refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w0, eps, R, scenario, onFinished, onLive],
  );

  const kidPose = pose({ shoulderL: 0.9, shoulderR: 0.9, elbowL: 0.6, elbowR: 0.6, spreadL: 0.3, spreadR: 0.3 });

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const live = liveAt(w0, eps, R, t);
          onSample({ t, phi: live.phi, omega: live.omega });
          onLive(live);
        }}
      />

      {scenario === "wheel" && (
        <>
          <WheelRoad />
          <group ref={hub} position={[0, R, 0]}>
            <group ref={spinGroup}>
              <BicycleWheel radius={R} rotation={[0, 0, -Math.PI / 2]} />
              <mesh ref={mark} position={[0, -R, 0.07 * R]}>
                <sphereGeometry args={[0.07 * R + 0.02, 14, 12]} />
                <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={1.2} toneMapped={false} />
              </mesh>
            </group>
            {/* fork, head tube and the start of the frame — it moves with the hub but does not spin */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[-0.12 * R, 0.65 * R, s * 0.13 * R]} rotation={[0, 0, 0.19]}>
                <cylinderGeometry args={[0.03 * R, 0.035 * R, 1.32 * R, 8]} />
                <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.35} />
              </mesh>
            ))}
            <mesh position={[-0.27 * R, 1.36 * R, 0]}>
              <boxGeometry args={[0.12 * R, 0.08 * R, 0.34 * R]} />
              <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh position={[-0.33 * R, 1.62 * R, 0]} rotation={[0, 0, 0.19]}>
              <cylinderGeometry args={[0.05 * R, 0.05 * R, 0.5 * R, 10]} />
              <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh position={[-0.4 * R, 1.9 * R, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.025 * R, 0.025 * R, 1.2 * R, 10]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.25} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[-0.4 * R, 1.9 * R, s * 0.52 * R]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.04 * R, 0.04 * R, 0.22 * R, 10]} />
                <meshStandardMaterial color="#18181b" roughness={0.8} />
              </mesh>
            ))}
            <mesh position={[-1.0 * R, 1.42 * R, 0]} rotation={[0, 0, -1.45]}>
              <cylinderGeometry args={[0.045 * R, 0.045 * R, 1.3 * R, 10]} />
              <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh position={[-0.95 * R, 0.95 * R, 0]} rotation={[0, 0, -0.95]}>
              <cylinderGeometry args={[0.05 * R, 0.05 * R, 1.35 * R, 10]} />
              <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.35} />
            </mesh>
            <SceneLabel position={[0, 2.25 * R, 0]}>колесо велосипеда</SceneLabel>
          </group>
          <Trail width={2.2} length={14} color="#facc15" attenuation={(w) => w} target={mark}>
            <mesh visible={false}>
              <sphereGeometry args={[0.01, 4, 4]} />
            </mesh>
          </Trail>
          <CameraFollow target={hub} lead={1.2} min={0} max={8} />
          <VectorArrow ref={cArrow} color="#60a5fa" />
        </>
      )}

      {scenario === "carousel" && (
        <>
          <CarouselBase />
          <group ref={spinGroup}>
            <mesh position={[0, 0.306, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <circleGeometry args={[R + 0.12, 48]} />
              <meshStandardMaterial map={deckTex} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0.27, 0]} castShadow>
              <cylinderGeometry args={[R + 0.12, R + 0.12, 0.06, 48]} />
              <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
            </mesh>
            {/* painted spoke the children stand on — they always share the same angle φ */}
            <mesh position={[R / 2, 0.31, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[R, 0.12]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>
            {KID_RADII.map((k, i) => (
              <group key={k} position={[k * R, 0.3, 0]}>
                <Person scale={0.6} pose={kidPose} shirt={["#16a34a", "#0891b2", "#ca8a04"][i]} pants="#1e293b" hair={i === 1 ? "#a16207" : "#3b2416"} longHair={i === 1} />
                <SceneLabel position={[0, 1.3 + i * 0.32, 0]} tone={KID_COLORS[i]}>
                  {i === 0 ? "у края, r = R" : i === 1 ? "r = 0,6R" : "у центра, r = 0,3R"}
                </SceneLabel>
              </group>
            ))}
            {[0.62, 0.95].map((k) => (
              <mesh key={k} position={[0, 0.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[k * R - 0.18, 0.025, 6, 48]} />
                <meshStandardMaterial color="#e5e7eb" metalness={0.8} roughness={0.3} />
              </mesh>
            ))}
          </group>
          {KID_COLORS.map((c, i) => (
            <VectorArrow key={c} ref={kidArrows[i]} color={c} />
          ))}
        </>
      )}

      {scenario === "abstract" && (
        <>
          <Turntable R={R} />
          <group ref={spinGroup}>
            <mesh position={[0, 0.065, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[R, 64]} />
              <meshStandardMaterial map={vinyl} roughness={0.35} metalness={0.2} />
            </mesh>
            <mesh position={[R, 0.075, 0]}>
              <cylinderGeometry args={[0.09, 0.09, 0.025, 20]} />
              <meshStandardMaterial color="#c084fc" emissive="#c084fc" emissiveIntensity={0.8} toneMapped={false} />
            </mesh>
            <SceneLabel position={[R, 0.45, 0]}>метка (наклейка)</SceneLabel>
          </group>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.1, 10]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
          </mesh>
          <SceneLabel position={[0.25 * R, -0.45 * R, 1.2 * R]}>проигрыватель пластинок</SceneLabel>
        </>
      )}

      {scenario !== "carousel" && (
        <>
          <VectorArrow ref={vArrow} color="#4ade80" />
          <VectorArrow ref={aArrow} color="#f87171" />
        </>
      )}
    </>
  );
}

const DEFAULTS: Record<Scenario, { w0: number; eps: number; R: number }> = {
  abstract: { w0: 1.5, eps: 0.5, R: 1.5 },
  wheel: { w0: 2.2, eps: 0.5, R: 0.7 },
  carousel: { w0: 0.8, eps: 0.15, R: 1.6 },
};

const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function RotationalKinematicsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const [c, set] = useControls("Вращение", () => ({
    scenario: {
      value: "carousel",
      label: "Жизненный пример",
      options: { "Карусель: трое детей": "carousel", "Колесо велосипеда катится": "wheel", "Пластинка (свои числа)": "abstract" },
    },
    w0: { value: DEFAULTS.carousel.w0, min: -6, max: 6, step: 0.1, label: "ω₀, рад/с" },
    eps: { value: DEFAULTS.carousel.eps, min: -3, max: 3, step: 0.05, label: "ε, рад/с²" },
    R: { value: DEFAULTS.carousel.R, min: 0.4, max: 2.5, step: 0.1, label: "R, м" },
  }));
  const scenario = c.scenario as Scenario;
  const { w0, eps, R } = c;

  const lastScenario = useRef(scenario);
  useEffect(() => {
    if (lastScenario.current === scenario) return;
    lastScenario.current = scenario;
    set(DEFAULTS[scenario]);
  }, [scenario, set]);

  const runKey = `${clock.resetNonce}|${scenario}|${w0}|${eps}|${R}`;
  const initial = useMemo(() => liveAt(w0, eps, R, 0), [w0, eps, R]);
  const [live, setLive] = useState<LiveNumbers>(initial);
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, phi: 0, omega: w0 }]);

  const play = clock.play;
  useEffect(() => {
    setLive(initial);
    setSeries([{ t: 0, phi: 0, omega: initial.omega }]);
    play();
  }, [runKey, initial, play]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const omega = live.omega;
  let caption;
  if (scenario === "wheel") {
    caption = (
      <>
        Центр колеса (синяя стрелка) едет со скоростью <b>v = ωR = {f2(Math.abs(live.v))} м/с</b>. Жёлтая метка на шине в момент касания
        дороги <b>стоит на месте</b>, а наверху несётся вдвое быстрее — {f2(2 * Math.abs(live.v))} м/с. Её след — <b>циклоида</b>.
      </>
    );
  } else if (scenario === "carousel") {
    caption = (
      <>
        Все трое поворачиваются на один и тот же угол — <b>ω одинакова</b>. Но круг у края длиннее, поэтому скорость v = ωr разная: у края{" "}
        <b style={{ color: KID_COLORS[0] }}>{f2(Math.abs(omega * KID_RADII[0] * R))}</b>, посередине{" "}
        <b style={{ color: KID_COLORS[1] }}>{f2(Math.abs(omega * KID_RADII[1] * R))}</b>, у центра <b style={{ color: KID_COLORS[2] }}>{f2(Math.abs(omega * KID_RADII[2] * R))}</b> м/с.
      </>
    );
  } else if (Math.abs(omega) < 0.08) {
    caption = <><b>Мгновенная остановка:</b> ω = 0, скорость метки нулевая, но угловое ускорение ε ≠ 0 — сейчас пластинка закрутится в обратную сторону.</>;
  } else if (eps === 0) {
    caption = <><b>Равномерное вращение:</b> ω постоянна, а ускорение метки всё равно есть — оно направлено точно к центру (центростремительное, a = ω²R). Оно меняет не величину скорости, а её направление.</>;
  } else if (omega * eps > 0) {
    caption = <><b>Пластинка раскручивается:</b> ω растёт на {f2(Math.abs(eps))} рад/с каждую секунду. Ускорение метки — сумма центростремительного (к центру) и касательного (по ходу вращения).</>;
  } else {
    caption = <><b>Пластинка тормозит:</b> касательная часть ускорения направлена против движения, ω уменьшается на {f2(Math.abs(eps))} рад/с каждую секунду.</>;
  }

  const legend: LegendItem[] =
    scenario === "carousel"
      ? [{ color: "#e5e7eb", label: "стрелки — скорость v каждого ребёнка" }]
      : scenario === "wheel"
        ? [
            { color: "#4ade80", label: "скорость метки" },
            { color: "#f87171", label: "ускорение метки" },
            { color: "#60a5fa", label: "скорость центра" },
            { color: "#facc15", label: "след — циклоида", kind: "line" },
          ]
        : [
            { color: "#4ade80", label: "скорость v = ωR" },
            { color: "#f87171", label: "ускорение a" },
          ];

  const numbers = [
    { label: "Время t", value: live.t.toFixed(2), unit: "с" },
    { label: "Угол φ", value: live.phi.toFixed(2), unit: "рад" },
    { label: "Угл. скорость ω", value: live.omega.toFixed(2), unit: "рад/с" },
    { label: scenario === "wheel" ? "Скорость центра v = ωR" : scenario === "carousel" ? "v у края = ωR" : "Линейная v = ωR", value: live.v.toFixed(2), unit: "м/с", color: "#4ade80" },
    ...(scenario === "wheel"
      ? [{ label: "Скорость метки", value: live.vMark.toFixed(2), unit: "м/с", color: "#facc15" }]
      : scenario === "carousel"
        ? [
            { label: "v при r = 0,6R", value: (omega * KID_RADII[1] * R).toFixed(2), unit: "м/с", color: KID_COLORS[1] },
            { label: "v при r = 0,3R", value: (omega * KID_RADII[2] * R).toFixed(2), unit: "м/с", color: KID_COLORS[2] },
          ]
        : [{ label: "Ускорение a", value: live.aTotal.toFixed(2), unit: "м/с²", color: "#f87171" }]),
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={scenario === "wheel" ? { position: [1.2, 1.6, 6.5], fov: 50 } : scenario === "carousel" ? { position: [0, 4.2, 6.2], fov: 50 } : { position: [0, 5.2, 5.6], fov: 50 }}
          orbitTarget={scenario === "wheel" ? [1.2, 0.8, 0] : scenario === "carousel" ? [0, 0.7, 0] : [0, 0, 0]}
          simplified={isMobile}
          maxDistance={scenario === "wheel" ? 26 : 20}
          minDistance={2}
          bloomThreshold={0.6}
          fogRange={[14, 45]}
        >
          <SceneContent
            key={runKey}
            scenario={scenario}
            w0={w0}
            eps={eps}
            R={R}
            running={clock.running}
            speed={clock.speed}
            onSample={handleSample}
            onLive={setLive}
            onFinished={handleFinished}
          />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={<NumberReadouts items={numbers} />}
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">φ(t) — угол поворота</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "phi", color: "#c084fc", label: "φ, рад" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">ω(t) — угловая скорость</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "omega", color: "#4ade80", label: "ω, рад/с" }]} />
          </div>
        </div>
      }
      note={
        scenario === "wheel" ? (
          <>
            Колесо катится без проскальзывания: центр смещается на x = Rφ и движется со скоростью v = ωR. Точка шины в
            нижнем положении неподвижна (это мгновенная ось вращения), в верхнем — движется со скоростью 2ωR. Поэтому у
            едущего велосипеда спицы внизу видны чётко, а вверху сливаются.
          </>
        ) : scenario === "carousel" ? (
          <>
            У всех точек твёрдого тела одинаковые φ, ω и ε, а линейная скорость v = ωr и центростремительное ускорение
            ω²r растут с расстоянием от оси. Поэтому на краю карусели «сдувает» сильнее всего.
          </>
        ) : (
          <>
            φ(t) = ω₀t + ½εt², ω(t) = ω₀ + εt. Линейная скорость метки v = ωR (зелёная стрелка, по касательной), полное
            ускорение a = a_n + a_τ: центростремительное ω²R (к центру) плюс касательное εR (по касательной) — красная
            стрелка. Пластинка на 33⅓ об/мин вращается с ω ≈ 3,5 рад/с.
          </>
        )
      }
    />
  );
}
