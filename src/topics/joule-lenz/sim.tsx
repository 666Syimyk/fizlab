import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Wire } from "@/components/sim/props/electric";
import { PowerSupply } from "@/components/sim/props/circuit";
import { PSU_MINUS, PSU_PLUS } from "@/components/sim/props/circuitLayout";
import { LabBench } from "@/components/sim/props/environment";
import { Steam } from "@/components/sim/props/thermo";
import { latheProfile } from "@/components/sim/props/shared";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const C_WATER = 4186;
const L_VAPOR = 2.26e6;
const T0 = 20;
/** heating a kettle takes minutes: the scene runs 60× faster than real time */
const TIMELAPSE = 60;
/** the thermostat switches the kettle off this many (real) seconds after the water boils */
const AUTO_OFF_AFTER = 20;
const COLD = new THREE.Color("#7dd3fc");
const HOT = new THREE.Color("#fb923c");
const N_BUBBLES = 40;

interface SamplePoint {
  t: number;
  T: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  T: number;
  Q: number;
  evaporated: number;
  state: "heating" | "boiling" | "off";
}

/** Physical state of the kettle at real time tPhys (analytic: P = const until the thermostat trips). */
function kettleState(tPhys: number, P: number, m: number) {
  const tBoil = ((100 - T0) * m * C_WATER) / P;
  const tOff = tBoil + AUTO_OFF_AFTER;
  const tHeat = Math.min(tPhys, tOff);
  const Q = P * tHeat;
  const T = Math.min(100, T0 + Q / (m * C_WATER));
  const evaporated = Math.max(0, (P * (tHeat - tBoil)) / L_VAPOR);
  const state: LiveNumbers["state"] = tPhys >= tOff ? "off" : tPhys >= tBoil ? "boiling" : "heating";
  return { Q, T, evaporated, state, tBoil };
}

const KETTLE_GLASS: [number, number][] = [
  [0.5, 0],
  [0.515, 0.25],
  [0.51, 0.55],
  [0.48, 0.82],
  [0.43, 0.98],
];

interface SceneContentProps {
  V: number;
  R: number;
  m: number;
  T: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ V, R, m, T, running, speed, onSample, onLive }: SceneContentProps) {
  const waterMat = useRef<THREE.MeshStandardMaterial>(null!);
  const water = useRef<THREE.Mesh>(null!);
  const heaterMat = useRef<THREE.MeshStandardMaterial>(null!);
  const bubbles = useRef<THREE.InstancedMesh>(null!);
  const steam = useRef<THREE.Group>(null!);
  const lamp = useRef<THREE.MeshStandardMaterial>(null!);
  const P = (V * V) / R;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const bubbleSeeds = useMemo(() => Array.from({ length: N_BUBBLES }, (_, i) => ({ a: i * 2.399, r: 0.08 + ((i * 37) % 23) / 23 * 0.3, phase: ((i * 53) % 41) / 41, v: 0.5 + ((i * 17) % 13) / 13 })), []);
  const heater = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 5;
      const r = 0.1 + 0.26 * (i / 120);
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.022, 6, false);
  }, []);
  useEffect(() => () => heater.dispose(), [heater]);
  const glass = latheProfile("kettle-glass", KETTLE_GLASS, 40);
  const waterTop0 = 0.2 + 0.78 * m;

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      const s = kettleState(t * TIMELAPSE, P, m);
      const frac = (s.T - T0) / (100 - T0);
      if (waterMat.current) {
        waterMat.current.color.copy(COLD).lerp(HOT, frac);
        waterMat.current.emissive.copy(COLD).lerp(HOT, frac);
      }
      const on = s.state !== "off";
      if (heaterMat.current) heaterMat.current.emissiveIntensity = on ? 0.4 + Math.min(P / 300, 1) * 2.2 : 0;
      if (lamp.current) lamp.current.emissiveIntensity = on ? 2 : 0;
      // the water level drops a little as it boils away
      const left = Math.max(m - s.evaporated, 0.02);
      const top = 0.2 + 0.78 * left;
      if (water.current) {
        water.current.scale.y = (top - 0.2) / (waterTop0 - 0.2);
        water.current.position.y = 0.2 + (top - 0.2) / 2;
      }
      // bubbles appear from ~60 °C and become a rolling boil at 100 °C
      const intensity = on ? THREE.MathUtils.clamp((s.T - 60) / 40, 0, 1) : 0;
      const b = bubbles.current;
      if (b) {
        bubbleSeeds.forEach((sd, i) => {
          sd.phase = (sd.phase + dt * sd.v * (0.4 + intensity)) % 1;
          const visible = i / N_BUBBLES < intensity;
          const y = 0.24 + sd.phase * (top - 0.26);
          dummy.position.set(Math.cos(sd.a) * sd.r, y, Math.sin(sd.a) * sd.r);
          dummy.scale.setScalar(visible ? 0.6 + sd.phase * 0.8 : 0);
          dummy.updateMatrix();
          b.setMatrixAt(i, dummy.matrix);
        });
        b.instanceMatrix.needsUpdate = true;
      }
      if (steam.current) steam.current.visible = s.state === "boiling";
    },
    [P, m, waterTop0, bubbleSeeds, dummy],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => {
          const tPhys = t * TIMELAPSE;
          const s = kettleState(tPhys, P, m);
          onSample({ t: Number(tPhys.toFixed(1)), T: s.T });
          onLive({ t: tPhys, T: s.T, Q: s.Q, evaporated: s.evaporated, state: s.state });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={5} depth={2.8} height={0.9} />
      <PowerSupply position={[-1.8, 0, -0.5]} volts={V} />
      <SceneLabel position={[-1.8, 0.95, -0.5]}>источник напряжения</SceneLabel>
      <Wire points={[[-1.8 + PSU_PLUS[0], PSU_PLUS[1], -0.5 + PSU_PLUS[2]], [-1.2, 0.04, 0.3], [-0.5, 0.04, 0.3]]} color="#dc2626" radius={0.025} />
      <Wire points={[[-1.8 + PSU_MINUS[0], PSU_MINUS[1], -0.5 + PSU_MINUS[2]], [-1.3, 0.04, 0.4], [-0.52, 0.04, 0.4]]} color="#1f2937" radius={0.025} />

      {/* kettle base station with a "power on" lamp */}
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.58, 0.6, 0.07, 36]} />
        <meshStandardMaterial color="#1f2937" roughness={0.5} />
      </mesh>
      <mesh position={[0.35, 0.05, 0.45]}>
        <sphereGeometry args={[0.03, 10, 8]} />
        <meshStandardMaterial ref={lamp} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* steel bottom with the heater, glass body, lid, handle, spout */}
      <mesh position={[0, 0.13, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.53, 0.12, 36]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh geometry={heater} position={[0, 0.23, 0]}>
        <meshStandardMaterial ref={heaterMat} color="#7c2d12" emissive="#f97316" emissiveIntensity={0.4} metalness={0.4} roughness={0.5} toneMapped={false} />
      </mesh>
      <mesh ref={water} position={[0, 0.2 + (waterTop0 - 0.2) / 2, 0]}>
        <cylinderGeometry args={[0.46, 0.475, waterTop0 - 0.2, 36]} />
        <meshStandardMaterial ref={waterMat} color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={0.15} transparent opacity={0.5} roughness={0.1} depthWrite={false} />
      </mesh>
      <instancedMesh ref={bubbles} args={[undefined, undefined, N_BUBBLES]} frustumCulled={false}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#f8fafc" transparent opacity={0.7} roughness={0.1} />
      </instancedMesh>
      <mesh geometry={glass} position={[0, 0.19, 0]}>
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.16} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.44, 0.06, 36]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[0, 1.27, 0]}>
        <sphereGeometry args={[0.06, 14, 10]} />
        <meshStandardMaterial color="#111827" roughness={0.4} />
      </mesh>
      <mesh position={[-0.52, 0.72, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <torusGeometry args={[0.36, 0.05, 10, 28, Math.PI]} />
        <meshStandardMaterial color="#111827" roughness={0.45} />
      </mesh>
      <mesh position={[0.5, 1.08, 0]} rotation={[0, 0, -0.8]}>
        <cylinderGeometry args={[0.05, 0.1, 0.28, 16, 1, true]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <group ref={steam} position={[0.62, 1.2, 0]} visible={false}>
        <Steam count={8} spread={0.12} height={1.1} />
      </group>
      <SceneLabel position={[0, 1.65, 0]}>{`чайник: ${m.toFixed(2).replace(".", ",")} кг воды`}</SceneLabel>
      <SceneLabel position={[0.95, 0.35, 0.3]}>{`спираль: ${(P >= 100 ? P.toFixed(0) : P.toFixed(1)).replace(".", ",")} Вт`}</SceneLabel>
      <SceneLabel position={[-0.9, 0.35, 0.65]}>{`вода: ${T.toFixed(0)} °C`}</SceneLabel>
    </>
  );
}

/* ---------- fuse ---------- */

interface FuseLive {
  t: number;
  T: number;
  blown: boolean;
}

const T_MELT = 900;
const FUSE_MASS = 2e-5; // kg — a thin fuse wire
const FUSE_C = 400; // J/(kg·K), copper-like alloy

/** Newton heating of the fuse wire: T → T_ss with time constant τ chosen so that the rated current just reaches T_melt. */
function fuseModel(I: number, R: number, Iblow: number) {
  const mc = FUSE_MASS * FUSE_C;
  const tau = ((T_MELT - T0) * mc) / (Iblow * Iblow * R);
  const dTss = (I / Iblow) ** 2 * (T_MELT - T0);
  const blows = I > Iblow;
  const tBlow = blows ? -tau * Math.log(1 - (Iblow / I) ** 2) : Infinity;
  const tempAt = (t: number) => (t >= tBlow ? T_MELT : T0 + dTss * (1 - Math.exp(-t / tau)));
  return { tau, tBlow, blows, tempAt, Tss: T0 + dTss };
}

function SceneFuse({ I, Rfuse, Iblow, running, speed, onLive }: { I: number; Rfuse: number; Iblow: number; running: boolean; speed: number; onLive: (n: FuseLive) => void }) {
  const wireMat = useRef<THREE.MeshStandardMaterial>(null!);
  const wire = useRef<THREE.Mesh>(null!);
  const stubs = useRef<THREE.Group>(null!);
  const glassMat = useRef<THREE.MeshStandardMaterial>(null!);
  const flash = useRef<THREE.PointLight>(null!);
  const heaterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7c2d12", emissive: "#f97316", emissiveIntensity: 1.5, toneMapped: false }), []);
  useEffect(() => () => heaterMat.dispose(), [heaterMat]);
  const model = useMemo(() => fuseModel(I, Rfuse, Iblow), [I, Rfuse, Iblow]);

  const handleFrame = useCallback(
    (t: number) => {
      const blown = t >= model.tBlow;
      const T = model.tempAt(t);
      const frac = THREE.MathUtils.clamp((T - T0) / (T_MELT - T0), 0, 1);
      if (wireMat.current) {
        wireMat.current.color.setRGB(1, 1 - frac * 0.6, 1 - frac * 0.9);
        wireMat.current.emissive.setRGB(1, 0.35 + frac * 0.4, 0.1);
        wireMat.current.emissiveIntensity = frac > 0.15 ? (frac - 0.15) * 4 : 0;
      }
      if (wire.current) wire.current.visible = !blown;
      if (stubs.current) stubs.current.visible = blown;
      if (glassMat.current) glassMat.current.color.set(blown ? "#52525b" : "#e0f2fe");
      if (flash.current) flash.current.intensity = blown ? 40 * Math.exp(-(t - model.tBlow) / 0.08) : 0;
      heaterMat.emissiveIntensity = blown ? 0 : 0.6 + Math.min(I / 20, 1) * 2.4;
    },
    [model, I, heaterMat],
  );

  const capX = 0.55;
  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => onLive({ t, T: model.tempAt(t), blown: t >= model.tBlow })}
      />

      <LabBench position={[0, -0.9, 0]} length={5.4} depth={2.6} height={0.9} />

      {/* fuse holder: ceramic base, two spring clips, glass cartridge (shown enlarged) */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.08, 0.55]} />
        <meshStandardMaterial color="#f5f5f4" roughness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.62, 0.22, 0]}>
          <boxGeometry args={[0.06, 0.3, 0.36]} />
          <meshStandardMaterial color="#d4a017" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.35, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.15, 0.15, 0.95, 28, 1, true]} />
        <meshStandardMaterial ref={glassMat} color="#e0f2fe" transparent opacity={0.28} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * capX, 0.35, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.165, 0.165, 0.18, 28]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
        </mesh>
      ))}
      <mesh ref={wire} position={[0, 0.35, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.95, 8]} />
        <meshStandardMaterial ref={wireMat} color="#f4f4f5" emissive="#ff6a00" emissiveIntensity={0} metalness={0.7} roughness={0.3} toneMapped={false} />
      </mesh>
      <group ref={stubs} visible={false}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.36, 0.35 - 0.02, 0]} rotation={[0, 0, Math.PI / 2 + s * 0.25]}>
            <cylinderGeometry args={[0.014, 0.014, 0.2, 8]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
      </group>
      <pointLight ref={flash} position={[0, 0.4, 0.2]} color="#fde68a" intensity={0} distance={5} />
      <SceneLabel position={[0, 0.85, 0]}>{`плавкий предохранитель на ${Iblow.toString().replace(".", ",")} А (увеличен)`}</SceneLabel>

      {/* wall socket on the left and a quartz heater on the right */}
      <group position={[-2.1, 0, 0]}>
        <mesh position={[0, 0.35, 0]} castShadow>
          <boxGeometry args={[0.5, 0.7, 0.2]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.35, 0.101]}>
          <circleGeometry args={[0.17, 28]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.065, 0.35, 0.103]}>
            <circleGeometry args={[0.025, 12]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        ))}
        <SceneLabel position={[0, 0.95, 0]}>розетка 220 В</SceneLabel>
      </group>
      <group position={[2.0, 0, 0]}>
        <mesh position={[0, 0.5, -0.05]} castShadow>
          <boxGeometry args={[0.9, 0.9, 0.12]} />
          <meshStandardMaterial color="#374151" metalness={0.5} roughness={0.4} />
        </mesh>
        {[0.25, 0.5, 0.75].map((y) => (
          <mesh key={y} position={[0, y, 0.05]} rotation={[0, 0, Math.PI / 2]} material={heaterMat}>
            <cylinderGeometry args={[0.04, 0.04, 0.75, 12]} />
          </mesh>
        ))}
        <SceneLabel position={[0, 1.2, 0]}>{`обогреватель: ${(220 * I).toFixed(0)} Вт`}</SceneLabel>
      </group>
      <Wire points={[[-1.85, 0.3, 0.05], [-1.3, 0.05, 0.2], [-0.66, 0.1, 0.12]]} color="#1f2937" radius={0.025} />
      <Wire points={[[0.66, 0.1, 0.12], [1.2, 0.05, 0.25], [1.6, 0.3, 0.05]]} color="#1f2937" radius={0.025} />
      <Wire points={[[-1.85, 0.4, -0.05], [-1.2, 0.04, -0.6], [1.3, 0.04, -0.6], [1.6, 0.5, -0.12]]} color="#1e3a8a" radius={0.025} />
    </>
  );
}

export function JouleLenzSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, V, R, m, Ifuse, Rfuse, Iblow } = useControls("Закон Джоуля-Ленца", {
    scenario: {
      value: "kettle",
      label: "Жизненный пример",
      options: { "Чайник": "kettle", "Предохранитель": "fuse" },
    },
    V: { value: 12, min: 3, max: 24, step: 1, label: "V, В", render: (get) => get("Закон Джоуля-Ленца.scenario") === "kettle" },
    R: { value: 1, min: 0.5, max: 15, step: 0.5, label: "R нагревателя, Ом", render: (get) => get("Закон Джоуля-Ленца.scenario") === "kettle" },
    m: { value: 0.3, min: 0.1, max: 1, step: 0.05, label: "m воды, кг", render: (get) => get("Закон Джоуля-Ленца.scenario") === "kettle" },
    Ifuse: { value: 8, min: 1, max: 20, step: 0.5, label: "I цепи, А", render: (get) => get("Закон Джоуля-Ленца.scenario") === "fuse" },
    Rfuse: { value: 0.05, min: 0.01, max: 0.2, step: 0.01, label: "R предохранителя, Ом", render: (get) => get("Закон Джоуля-Ленца.scenario") === "fuse" },
    Iblow: { value: 10, min: 2, max: 20, step: 0.5, label: "Номинал (I перегорания), А", render: (get) => get("Закон Джоуля-Ленца.scenario") === "fuse" },
  });
  const isFuse = scenario === "fuse";

  const I = V / R;
  const P = I * I * R;
  const tBoil = ((100 - T0) * m * C_WATER) / P;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, T: T0, Q: 0, evaporated: 0, state: "heating" });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, T: T0 }]);
  const [fuseLive, setFuseLive] = useState<FuseLive>({ t: 0, T: 20, blown: false });

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, T: T0, Q: 0, evaporated: 0, state: "heating" });
    setSeries([{ t: 0, T: T0 }]);
    setFuseLive({ t: 0, T: 20, blown: false });
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  // a new kettle / a new fuse whenever the parameters change
  const paramKey = `${scenario}|${V}|${R}|${m}|${Ifuse}|${Rfuse}|${Iblow}`;
  const lastKey = useRef(paramKey);
  useEffect(() => {
    if (lastKey.current === paramKey) return;
    lastKey.current = paramKey;
    handleReset();
  }, [paramKey, handleReset]);

  const Pfuse = Ifuse * Ifuse * Rfuse;
  const fuse = useMemo(() => fuseModel(Ifuse, Rfuse, Iblow), [Ifuse, Rfuse, Iblow]);
  const fmt = (v: number, d = 0) => v.toFixed(d).replace(".", ",");
  const minutes = (s: number) => (s >= 90 ? `${fmt(s / 60, 1)} мин` : `${fmt(s)} с`);

  const caption = isFuse ? (
    fuseLive.blown ? (
      <>
        <b>Предохранитель перегорел!</b> Ток {fmt(Ifuse, 1)} А больше номинала {fmt(Iblow, 1)} А: тонкая проволочка нагрелась до ~{T_MELT} °C и расплавилась. Цепь разорвана — обогреватель
        выключился, а провода в стене не успели перегреться.
      </>
    ) : Ifuse > Iblow ? (
      <>
        Ток {fmt(Ifuse, 1)} А <b>больше номинала</b> {fmt(Iblow, 1)} А: проволочка в предохранителе раскаляется (Q = I²Rt) и через {fmt(fuse.tBlow, 1)} с расплавится.
      </>
    ) : (
      <>
        Ток {fmt(Ifuse, 1)} А не больше номинала: проволочка греется, но остывает так же быстро, и её температура остановится на ~{fmt(fuse.Tss)} °C. Включите прибор помощнее — увеличьте ток выше{" "}
        {fmt(Iblow, 1)} А.
      </>
    )
  ) : live.state === "off" ? (
    <>
      Вода вскипела, и <b>термостат выключил чайник</b>. Всего спираль выделила Q = I²Rt ≈ {fmt(live.Q / 1000, 1)} кДж теплоты.
    </>
  ) : live.state === "boiling" ? (
    <>
      <b>Кипит!</b> Теперь теплота спирали идёт не на нагрев, а на превращение воды в пар — температура держится 100 °C, а пар валит из носика.
    </>
  ) : (
    <>
      Ток I = V/R = {fmt(I, 1)} А проходит через спираль, и она отдаёт воде теплоту <b>Q = I²Rt</b>: мощность {fmt(P)} Вт. Вода нагрелась до {fmt(live.T)} °C, закипит примерно через{" "}
      {minutes(tBoil)} (сцена ускорена в {TIMELAPSE} раз).
    </>
  );
  const legend: LegendItem[] = isFuse
    ? [
        { color: "#f97316", label: "раскалённая проволочка", kind: "line" },
        { color: "#e0f2fe", label: "стеклянный корпус", kind: "square" },
      ]
    : [
        { color: "#f97316", label: "горячая спираль", kind: "line" },
        { color: "#7dd3fc", label: "холодная вода", kind: "square" },
        { color: "#fb923c", label: "горячая вода", kind: "square" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isFuse ? { position: [0.2, 2.6, 6.0] as [number, number, number], fov: 50 } : { position: [1.6, 2.2, 3.6] as [number, number, number], fov: 50 }}
          orbitTarget={isFuse ? [0, 0.35, 0] : [-0.2, 0.6, 0]}
          simplified={isMobile}
          maxDistance={14}
          minDistance={2.5}
          bloomThreshold={0.7}
          fogRange={[12, 36]}
        >
          {isFuse ? (
            <SceneFuse key={clock.resetNonce} I={Ifuse} Rfuse={Rfuse} Iblow={Iblow} running={clock.running} speed={clock.speed} onLive={setFuseLive} />
          ) : (
            <SceneContent key={clock.resetNonce} V={V} R={R} m={m} T={live.T} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isFuse ? (
          <NumberReadouts
            items={[
              { label: "I цепи", value: Ifuse.toFixed(1), unit: "А" },
              { label: "P = I²R на вставке", value: Pfuse.toFixed(2), unit: "Вт", color: "#f87171" },
              { label: "T вставки", value: fuseLive.T.toFixed(0), unit: "°C" },
              { label: "Состояние", value: fuseLive.blown ? "перегорел" : Ifuse > Iblow ? "греется к перегоранию" : "в норме", unit: "" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "I = V/R", value: I.toFixed(2), unit: "А" },
              { label: "P = I²R", value: P.toFixed(1), unit: "Вт", color: "#f87171" },
              { label: "Q(t) = Pt", value: live.Q.toFixed(0), unit: "Дж" },
              { label: "T(t) воды", value: live.T.toFixed(1), unit: "°C" },
              { label: "Время (ускорено ×60)", value: live.t.toFixed(0), unit: "с" },
              { label: "Время до кипения", value: Number.isFinite(tBoil) ? tBoil.toFixed(0) : "—", unit: "с" },
            ]}
          />
        )
      }
      graphs={
        isFuse ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Плавкая вставка нагревается той же мощностью P=I²R и одновременно отдаёт тепло воздуху. При токе
            ниже номинала нагрев и остывание уравновешиваются — температура вставки останавливается. Если ток
            превышает номинал, вставка успевает разогреться до температуры плавления и перегорает, разрывая
            цепь: чем больше перегрузка, тем быстрее. Это защищает проводку от перегрева и пожара.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Нагрев воды T(t): линейный рост при P=const, затем кипение при 100 °C</p>
            <LiveChart data={series} xKey="t" xType="number" xLabel="t, с" series={[{ key: "T", color: "#f87171", label: "T, °C" }]} />
          </div>
        )
      }
      note={
        isFuse ? (
          <>
            Закон Джоуля-Ленца: Q=I²Rt. У предохранителя тонкая вставка с малой массой и высоким сопротивлением
            специально рассчитана так, чтобы при токе выше номинала она нагревалась до температуры плавления
            за доли секунды или секунды и разрывала цепь раньше, чем перегреются провода в стенах.
          </>
        ) : (
          <>
            Закон Джоуля-Ленца: количество теплоты Q=I²Rt. При постоянной мощности температура воды растёт
            линейно T(t)=T₀+I²Rt/(mc), где c — удельная теплоёмкость воды (4186 Дж/(кг·К)). При 100 °C рост
            прекращается: теплота уходит на испарение (L = 2,26 МДж/кг), пока термостат не выключит чайник.
            Нагрев занимает минуты, поэтому сцена ускорена в 60 раз.
          </>
        )
      }
    />
  );
}
