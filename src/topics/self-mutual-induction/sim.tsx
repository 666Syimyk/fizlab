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
import { Coil, LightBulb, Resistor, Wire } from "@/components/sim/props/electric";
import { BulbSocket, CurrentFlow, Meter, PowerSupply } from "@/components/sim/props/circuit";
import { LabBench } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/** the transient lasts milliseconds: it is replayed 60× slower */
const SLOWMO = 60;

interface SamplePoint {
  t: number;
  I1n: number;
  V2n: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  I1: number;
  WL: number;
  V2: number;
}

type V3 = [number, number, number];

/* ---------- layout of the switch-on experiment (bench top at y = 0) ---------- */
const XL = -1.9; // "+" bus
const XR = 2.6; // "−" bus
const ZA = 1.1; // branch with the resistor
const ZB = -0.6; // branch with the coil
const CORE_Y = 0.45;
const PRI = { x0: -0.5, x1: 0.7, r: 0.3 };
const SEC = { x0: -1.25, x1: -0.75, r: 0.3 };
const PSU_POS: V3 = [-2.9, 0, 0.3];
const P_PLUS: V3 = [-2.57, 0.15, 0.05];
const P_MINUS: V3 = [-2.57, 0.15, 0.55];
const GALVO: V3 = [-1.0, 0.23, -1.5];

function primaryHelix(turns: number): V3[] {
  const pts: V3[] = [];
  const steps = turns * 16;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push([PRI.x0 + (i / steps) * (PRI.x1 - PRI.x0), CORE_Y + Math.sin(a) * PRI.r, ZB + Math.cos(a) * PRI.r]);
  }
  return pts;
}

// every path is listed in the direction the electrons move
const E_MINUS: V3[] = [P_MINUS, [-2.4, 0.04, 1.6], [XR, 0.04, 1.6], [XR, 0.04, ZA]];
const E_BUS_R: V3[] = [[XR, 0.04, ZA], [XR, 0.04, ZB]];
const E_A1: V3[] = [[XR, 0.04, ZA], [1.96, 0.14, ZA]];
const E_A2: V3[] = [[0.84, 0.14, ZA], [0.16, 0.06, ZA]];
const E_A3: V3[] = [[-0.16, 0.06, ZA], [XL, 0.04, ZA]];
const E_B1: V3[] = [[XR, 0.04, ZB], [1.66, 0.06, ZB]];
const E_B2: V3[] = [[1.34, 0.06, ZB], [1.0, 0.04, -0.4], [PRI.x1, CORE_Y, ZB + PRI.r]];
const E_B3: V3[] = [[PRI.x0, CORE_Y, ZB + PRI.r], [-0.55, 0.04, -0.15], [XL, 0.04, -0.15]];
const E_BUS_L1: V3[] = [[XL, 0.04, ZA], [XL, 0.04, 0.05]];
const E_BUS_L2: V3[] = [[XL, 0.04, -0.15], [XL, 0.04, 0.05]];
const E_PLUS: V3[] = [[XL, 0.04, 0.05], [-2.2, 0.12, 0.05], P_PLUS];
const SEC_W1: V3[] = [[SEC.x0, CORE_Y, ZB - SEC.r], [-1.2, 0.04, -1.2], [GALVO[0] - 0.15, 0.04, GALVO[2] + 0.11]];
const SEC_W2: V3[] = [[GALVO[0] + 0.15, 0.04, GALVO[2] + 0.11], [-0.8, 0.04, -1.2], [SEC.x1, CORE_Y, ZB - SEC.r]];

interface SceneContentProps {
  V0: number;
  R: number;
  L: number;
  M: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ V0, R, L, M, running, speed, onSample, onLive }: SceneContentProps) {
  const tau = L / R;
  const Imax = V0 / R;
  const helix = useMemo(() => primaryHelix(9), []);
  const helixBack = useMemo(() => [...helix].reverse(), [helix]);
  const lampA = useRef(0);
  const lampB = useRef(0);
  const galvo = useRef(0.5);
  const vA = useRef(0);
  const vB = useRef(0);
  const vSum = useRef(0);
  const v2 = useRef(0);
  const scale = Math.min((V0 / 12) ** 2, 1.5);

  useEffect(() => {
    if (!running) {
      vA.current = 0;
      vB.current = 0;
      vSum.current = 0;
      v2.current = 0;
    }
  }, [running]);

  const handleFrame = useCallback(
    (t: number) => {
      const tp = t / SLOWMO;
      const fracB = 1 - Math.exp(-tp / tau);
      lampA.current = scale;
      lampB.current = fracB * fracB * scale;
      const k = 1.6 * speed * Math.min(V0 / 12, 1.5);
      vA.current = k;
      vB.current = k * fracB;
      vSum.current = k * (1 + fracB) * 0.6;
      // EMF₂ = M·dI₁/dt is largest at the switching moment and dies away
      const e2 = Math.exp(-tp / tau);
      galvo.current = 0.5 + 0.48 * e2;
      v2.current = 2.5 * e2 * speed;
    },
    [tau, scale, V0, speed],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const tp = t / SLOWMO;
          const I1 = Imax * (1 - Math.exp(-tp / tau));
          const WL = 0.5 * L * I1 * I1;
          const V2 = M * (Imax / tau) * Math.exp(-tp / tau);
          onSample({ t: Number((tp * 1000).toFixed(2)), I1n: I1 / Imax, V2n: V2 / (M * Imax / tau || 1) });
          onLive({ t: tp, I1, WL, V2 });
        }}
      />

      <LabBench position={[0, -0.9, 0.1]} length={7} depth={4} height={0.9} />
      <PowerSupply position={PSU_POS} rotation={[0, Math.PI / 2, 0]} volts={V0} />
      <SceneLabel position={[PSU_POS[0], 0.95, PSU_POS[2]]}>источник</SceneLabel>

      {/* knife switch, already closed at t = 0 */}
      <group position={[-2.22, 0, 0.05]}>
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[0.42, 0.06, 0.22]} />
          <meshStandardMaterial color="#f5f5f4" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.36, 0.025, 0.05]} />
          <meshStandardMaterial color="#d4a017" metalness={0.85} roughness={0.3} />
        </mesh>
        <mesh position={[0.2, 0.14, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.1, 10]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
      <SceneLabel position={[-2.22, 0.45, 0.05]}>ключ замкнули при t = 0</SceneLabel>

      {/* copper bus bars */}
      {[XL, XR].map((x) => (
        <mesh key={x} position={[x, 0.025, (ZA + ZB) / 2 + 0.1]}>
          <boxGeometry args={[0.08, 0.05, ZA - ZB + 0.4]} />
          <meshStandardMaterial color="#c2773a" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}

      {/* branch A: lamp + plain resistor — lights up at once */}
      <BulbSocket position={[0, 0, ZA]} />
      <LightBulb position={[0, 0.12, ZA]} brightnessRef={lampA} />
      <Resistor position={[1.4, 0.14, ZA]} ohms={R} />
      <SceneLabel position={[0.7, 1.15, ZA]}>лампа 1 + резистор R</SceneLabel>

      {/* branch B: coil on an iron core + lamp — lights up with a delay */}
      <mesh position={[-0.3, CORE_Y, ZB]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 2.2, 20]} />
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.45} />
      </mesh>
      {[-1.45, 0.85].map((x) => (
        <mesh key={x} position={[x, (CORE_Y - 0.16) / 2, ZB]} castShadow>
          <boxGeometry args={[0.18, CORE_Y - 0.16, 0.4]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.7} />
        </mesh>
      ))}
      <Coil position={[(PRI.x0 + PRI.x1) / 2, CORE_Y, ZB]} turns={9} radius={PRI.r} length={PRI.x1 - PRI.x0} wire={0.035} />
      <SceneLabel position={[(PRI.x0 + PRI.x1) / 2, CORE_Y + 0.62, ZB]}>катушка L с железным сердечником</SceneLabel>
      <BulbSocket position={[1.5, 0, ZB]} />
      <LightBulb position={[1.5, 0.12, ZB]} brightnessRef={lampB} />
      <SceneLabel position={[1.6, 1.15, ZB]}>лампа 2</SceneLabel>

      {/* secondary coil on the same core with a galvanometer */}
      <Coil position={[(SEC.x0 + SEC.x1) / 2, CORE_Y, ZB]} rotation={[Math.PI, 0, 0]} turns={5} radius={SEC.r} length={SEC.x1 - SEC.x0} wire={0.03} color="#9a3412" />
      <SceneLabel position={[(SEC.x0 + SEC.x1) / 2 - 0.75, CORE_Y + 0.25, ZB + 0.45]}>вторая катушка (M)</SceneLabel>
      <Meter position={GALVO} letter="мА" valueRef={galvo} />
      <SceneLabel position={[GALVO[0] - 0.55, 0.5, GALVO[2]]}>гальванометр</SceneLabel>
      <Wire points={SEC_W1} color="#1f2937" radius={0.02} />
      <Wire points={SEC_W2} color="#dc2626" radius={0.02} />
      <CurrentFlow points={SEC_W1} count={6} speedRef={v2} radius={0.032} />
      <CurrentFlow points={SEC_W2} count={6} speedRef={v2} radius={0.032} />

      {/* wiring with drifting electrons */}
      {[E_MINUS, E_BUS_R, E_A1, E_A2, E_A3, E_B1, E_B2, E_B3, E_BUS_L1, E_BUS_L2, E_PLUS].map((p, i) => (
        <Wire key={i} points={p} color={i >= 8 ? "#dc2626" : "#1f2937"} radius={0.022} />
      ))}
      <CurrentFlow points={E_MINUS} count={18} speedRef={vSum} radius={0.035} />
      <CurrentFlow points={E_BUS_R} count={5} speedRef={vB} radius={0.035} />
      {[E_A1, E_A2, E_A3, E_BUS_L1].map((p, i) => (
        <CurrentFlow key={i} points={p} count={i === 2 ? 6 : 4} speedRef={vA} radius={0.035} />
      ))}
      {[E_B1, E_B2, E_B3, E_BUS_L2].map((p, i) => (
        <CurrentFlow key={i} points={p} count={i === 2 ? 6 : 4} speedRef={vB} radius={0.035} />
      ))}
      <CurrentFlow points={helixBack} count={18} speedRef={vB} radius={0.04} />
      <CurrentFlow points={E_PLUS} count={4} speedRef={vSum} radius={0.035} />
    </>
  );
}

/* ---------- transformer: mains → primary winding → iron core → secondary winding → lamp ---------- */
interface TransformerLive {
  t: number;
  v1: number;
  v2: number;
  P: number;
}

const CORE_W = 1.8;
const CORE_H = 1.6;
const CORE_BASE = 0.2;

function SceneTransformer({ V1amp, omega, n1, n2, Rload, running, speed, onLive }: { V1amp: number; omega: number; n1: number; n2: number; Rload: number; running: boolean; speed: number; onLive: (n: TransformerLive) => void }) {
  const ratio = n2 / n1;
  const bulb = useRef(0);
  const flux = useRef(0);
  const e1 = useRef(0);
  const e2 = useRef(0);
  const coreLoop: V3[] = useMemo(() => {
    const x = CORE_W / 2;
    const y0 = CORE_BASE + 0.08;
    const y1 = CORE_BASE + CORE_H - 0.08;
    return [
      [-x, y0, 0.19],
      [-x, y1, 0.19],
      [x, y1, 0.19],
      [x, y0, 0.19],
    ];
  }, []);

  useEffect(() => {
    if (!running) {
      flux.current = 0;
      e1.current = 0;
      e2.current = 0;
    }
  }, [running]);

  const handleFrame = useCallback(
    (t: number) => {
      const v1 = V1amp * Math.sin(omega * t);
      const v2 = v1 * ratio;
      const P = (v2 * v2) / Rload;
      bulb.current = Math.min(P / 100, 1.5);
      // Φ ∝ −cos ωt: the "flux" dots run around the core one way, then the other
      flux.current = -Math.cos(omega * t) * 1.6 * speed;
      e1.current = Math.sin(omega * t) * 1.5 * speed;
      e2.current = Math.sin(omega * t) * 1.5 * speed * Math.min(Math.sqrt(1 / Math.max(ratio, 0.05)), 3) * 0.5;
    },
    [V1amp, omega, ratio, Rload, speed],
  );

  const turns1 = THREE.MathUtils.clamp(Math.round(n1 / 20), 4, 18);
  const turns2 = THREE.MathUtils.clamp(Math.round(n2 / 20), 2, 18);
  const legY = CORE_BASE + CORE_H / 2;
  const w1a: V3[] = [[-2.45, 0.42, 0.11], [-2.0, 0.04, 0.5], [-1.2, 0.04, 0.5], [-CORE_W / 2 - 0.05, legY - 0.45, 0.3]];
  const w1b: V3[] = [[-CORE_W / 2 - 0.05, legY + 0.45, 0.3], [-1.4, 1.0, 0.7], [-2.2, 0.04, 0.9], [-2.45, 0.32, 0.11]];
  const w2a: V3[] = [[CORE_W / 2 + 0.05, legY - 0.45, 0.3], [1.4, 0.04, 0.6], [2.04, 0.06, 0.6]];
  const w2b: V3[] = [[2.36, 0.06, 0.6], [2.6, 0.04, 0.9], [1.4, 1.0, 0.8], [CORE_W / 2 + 0.05, legY + 0.45, 0.3]];

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={30}
        onSample={(t) => {
          const v1 = V1amp * Math.sin(omega * t);
          const v2 = v1 * ratio;
          onLive({ t, v1, v2, P: (v2 * v2) / Rload });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={6.4} depth={3} height={0.9} />
      {/* laminated iron core: a closed rectangular frame */}
      {[
        { p: [0, CORE_BASE + 0.08, 0] as V3, s: [CORE_W + 0.32, 0.32, 0.32] as V3 },
        { p: [0, CORE_BASE + CORE_H - 0.08, 0] as V3, s: [CORE_W + 0.32, 0.32, 0.32] as V3 },
        { p: [-CORE_W / 2, legY, 0] as V3, s: [0.32, CORE_H, 0.32] as V3 },
        { p: [CORE_W / 2, legY, 0] as V3, s: [0.32, CORE_H, 0.32] as V3 },
      ].map((b, i) => (
        <mesh key={i} position={b.p} castShadow>
          <boxGeometry args={b.s} />
          <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.4} />
        </mesh>
      ))}
      {[-0.12, -0.04, 0.04, 0.12].map((z) => (
        <mesh key={z} position={[0, CORE_BASE + CORE_H - 0.08, z + 0.001]}>
          <boxGeometry args={[CORE_W + 0.33, 0.33, 0.004]} />
          <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <CurrentFlow points={coreLoop} closed count={16} speedRef={flux} color="#a78bfa" radius={0.06} />
      <SceneLabel position={[0, CORE_BASE + CORE_H + 0.45, 0]}>стальной сердечник: по нему «бегает» магнитный поток</SceneLabel>

      {/* windings around the two legs */}
      <Coil position={[-CORE_W / 2, legY, 0]} rotation={[0, 0, Math.PI / 2]} turns={turns1} radius={0.3} length={1.0} wire={0.04} />
      <Coil position={[CORE_W / 2, legY, 0]} rotation={[0, 0, Math.PI / 2]} turns={turns2} radius={0.3} length={1.0} wire={turns2 > 10 ? 0.03 : 0.05} />
      <SceneLabel position={[-CORE_W / 2 - 0.2, CORE_BASE - 0.05, 0.75]}>{`первичная, N₁ = ${n1}`}</SceneLabel>
      <SceneLabel position={[CORE_W / 2 + 0.2, CORE_BASE - 0.05, 0.75]}>{`вторичная, N₂ = ${n2}`}</SceneLabel>

      {/* mains socket on the left, lamp on the right */}
      <group position={[-2.6, 0, 0]}>
        <mesh position={[0, 0.38, 0]} castShadow>
          <boxGeometry args={[0.46, 0.66, 0.18]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.38, 0.091]}>
          <circleGeometry args={[0.16, 28]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
        </mesh>
        <SceneLabel position={[0, 0.95, 0]}>{`сеть ~${V1amp} В`}</SceneLabel>
      </group>
      <BulbSocket position={[2.2, 0, 0.6]} />
      <LightBulb position={[2.2, 0.12, 0.6]} brightnessRef={bulb} />
      <SceneLabel position={[2.2, 1.2, 0.6]}>лампа (нагрузка)</SceneLabel>

      <Wire points={w1a} color="#1f2937" radius={0.022} />
      <Wire points={w1b} color="#1f2937" radius={0.022} />
      <Wire points={w2a} color="#475569" radius={0.022} />
      <Wire points={w2b} color="#475569" radius={0.022} />
      <CurrentFlow points={w1a} count={8} speedRef={e1} radius={0.034} />
      <CurrentFlow points={w1b} count={8} speedRef={e1} radius={0.034} />
      <CurrentFlow points={w2a} count={6} speedRef={e2} radius={0.034} />
      <CurrentFlow points={w2b} count={8} speedRef={e2} radius={0.034} />
    </>
  );
}

export function SelfMutualInductionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, V0, R, Lmh, Mmh, V1amp, freq, n1, n2, Rload } = useControls("Само- и взаимоиндукция", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Включение: лампа с катушкой загорается позже": "abstract", "Трансформатор": "transformer" },
    },
    V0: { value: 12, min: 3, max: 24, step: 1, label: "V₀, В", render: (get) => get("Само- и взаимоиндукция.scenario") === "abstract" },
    R: { value: 6, min: 1, max: 20, step: 0.5, label: "R, Ом", render: (get) => get("Само- и взаимоиндукция.scenario") === "abstract" },
    Lmh: { value: 200, min: 50, max: 500, step: 10, label: "L, мГн (первичная катушка)", render: (get) => get("Само- и взаимоиндукция.scenario") === "abstract" },
    Mmh: { value: 60, min: 10, max: 150, step: 5, label: "M, мГн (взаимная индукция)", render: (get) => get("Само- и взаимоиндукция.scenario") === "abstract" },
    V1amp: { value: 220, min: 20, max: 400, step: 10, label: "V₁ амплитуда, В", render: (get) => get("Само- и взаимоиндукция.scenario") === "transformer" },
    freq: { value: 1, min: 0.2, max: 3, step: 0.1, label: "частота (замедлено), Гц", render: (get) => get("Само- и взаимоиндукция.scenario") === "transformer" },
    n1: { value: 200, min: 20, max: 400, step: 10, label: "N₁ (первичная)", render: (get) => get("Само- и взаимоиндукция.scenario") === "transformer" },
    n2: { value: 40, min: 20, max: 400, step: 10, label: "N₂ (вторичная)", render: (get) => get("Само- и взаимоиндукция.scenario") === "transformer" },
    Rload: { value: 20, min: 5, max: 100, step: 5, label: "R нагрузки, Ом", render: (get) => get("Само- и взаимоиндукция.scenario") === "transformer" },
  });
  const isTransformer = scenario === "transformer";
  const omegaT = 2 * Math.PI * freq;
  const [tLive, setTLive] = useState<TransformerLive>({ t: 0, v1: 0, v2: 0, P: 0 });
  const L = Lmh / 1000;
  const M = Mmh / 1000;
  const tau = L / R;
  const Imax = V0 / R;

  const curve = useMemo(() => {
    const pts: { t: number; I1: number }[] = [];
    for (let i = 0; i <= 50; i++) {
      const t = (5 * tau * i) / 50;
      pts.push({ t: Number((t * 1000).toFixed(2)), I1: Number((Imax * (1 - Math.exp(-t / tau))).toFixed(3)) });
    }
    return pts;
  }, [tau, Imax]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, I1: 0, WL: 0, V2: (M * Imax) / tau });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, I1n: 0, V2n: 1 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, I1: 0, WL: 0, V2: (M * Imax) / tau });
    setSeries([{ t: 0, I1n: 0, V2n: 1 }]);
  }, [M, Imax, tau]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  // switching on again whenever the circuit parameters change
  const paramKey = `${scenario}|${V0}|${R}|${Lmh}|${Mmh}`;
  const lastKey = useRef(paramKey);
  useEffect(() => {
    if (lastKey.current === paramKey) return;
    lastKey.current = paramKey;
    handleReset();
  }, [paramKey, handleReset]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const pct = Imax > 0 ? Math.round((live.I1 / Imax) * 100) : 0;
  const caption = isTransformer ? (
    <>
      Переменный ток в первичной обмотке гоняет <b>магнитный поток</b> по стальному сердечнику то в одну, то в другую сторону (фиолетовые точки). Этот поток проходит через вторичную обмотку и наводит в
      ней напряжение: V₂ = V₁·N₂/N₁ = {fmt((V1amp * n2) / n1, 0)} В — трансформатор {n2 > n1 ? <b>повышающий</b> : <b>понижающий</b>}. Так зарядник телефона превращает 220 В в 5 В.
    </>
  ) : (
    <>
      Ключ замкнули. Лампа 1 (с резистором) вспыхнула сразу, а лампа 2 разгорается <b>постепенно</b>: катушка мешает току нарастать — это самоиндукция. Ток через катушку сейчас {pct} % от максимума (за τ =
      L/R = {fmt(tau * 1000, 0)} мс — 63 %). Гальванометр второй катушки дёрнулся в момент включения — это взаимоиндукция. Показано в 60 раз медленнее.
    </>
  );
  const legend: LegendItem[] = isTransformer
    ? [
        { color: "#a78bfa", label: "магнитный поток в сердечнике", kind: "dot" },
        { color: "#7dd3fc", label: "электроны (переменный ток)", kind: "dot" },
      ]
    : [
        { color: "#7dd3fc", label: "электроны (скорость ∝ току)", kind: "dot" },
        { color: "#c2773a", label: "медные шины", kind: "square" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isTransformer ? { position: [0.3, 2.8, 6.6] as [number, number, number], fov: 50 } : { position: [0.1, 3.9, 6.3] as [number, number, number], fov: 50 }}
          orbitTarget={isTransformer ? [0, 0.9, 0] : [-0.2, 0.3, 0.1]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isTransformer ? (
            <SceneTransformer key={clock.resetNonce} V1amp={V1amp} omega={omegaT} n1={n1} n2={n2} Rload={Rload} running={clock.running} speed={clock.speed} onLive={setTLive} />
          ) : (
            <SceneContent key={clock.resetNonce} V0={V0} R={R} L={L} M={M} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isTransformer ? (
          <NumberReadouts
            items={[
              { label: "Коэфф. трансформации N₂/N₁", value: (n2 / n1).toFixed(3) },
              { label: "V₁(t) первичная", value: tLive.v1.toFixed(1), unit: "В" },
              { label: "V₂(t) = V₁·N₂/N₁", value: tLive.v2.toFixed(1), unit: "В", color: "#5eead4" },
              { label: "Тип", value: n2 > n1 ? "повышающий" : n2 < n1 ? "понижающий" : "1 : 1" },
              { label: "P на нагрузке", value: tLive.P.toFixed(1), unit: "Вт", color: "#facc15" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время после включения", value: (live.t * 1000).toFixed(1), unit: "мс" },
              { label: "τ = L/R", value: (tau * 1000).toFixed(2), unit: "мс" },
              { label: "I₁(t) в первичной катушке", value: live.I1.toFixed(3), unit: "А" },
              { label: "W_L = LI₁²/2", value: (live.WL * 1000).toFixed(3), unit: "мДж" },
              { label: "ЭДС₂ = −M·dI₁/dt (во вторичной)", value: (live.V2 * 1000).toFixed(2), unit: "мВ" },
            ]}
          />
        )
      }
      graphs={
        isTransformer ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Переменный ток в первичной обмотке создаёт переменный магнитный поток в сердечнике, который
            пронизывает и вторичную обмотку. Отношение напряжений равно отношению чисел витков:
            V₂/V₁=N₂/N₁. Если N₂ больше N₁ — трансформатор повышающий (например, на выходе электростанции);
            если меньше — понижающий (например, в блоке питания зарядного устройства).
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">I₁(t) = I_max(1−e^(−t/τ))</p>
              <LiveChart data={curve} xKey="t" xType="number" xLabel="t, мс" series={[{ key: "I1", color: "#fbbf24", label: "I₁, А" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Нормированные I₁(t) и ЭДС₂(t)</p>
              <LiveChart data={series} xKey="t" xType="number" xLabel="t, мс" series={[{ key: "I1n", color: "#fbbf24", label: "I₁/I_max" }, { key: "V2n", color: "#5eead4", label: "ЭДС₂/ЭДС₂(0)" }]} />
            </div>
          </div>
        )
      }
      note={
        isTransformer ? (
          <>
            Идеальный трансформатор сохраняет мощность: V₁I₁=V₂I₂, поэтому во сколько раз растёт напряжение,
            во столько же раз падает ток (I₂=I₁·N₁/N₂). Именно поэтому электроэнергию передают на большие
            расстояния при высоком напряжении и низком токе — это резко уменьшает тепловые потери I²R
            в проводах линии передачи.
          </>
        ) : (
          <>
            Самоиндукция: при замыкании цепи с катушкой L ток растёт не мгновенно, а по экспоненте
            I₁(t)=I_max(1−e^(−t/τ)), τ=L/R — катушка «сопротивляется» изменению тока, поэтому лампа 2
            разгорается позже лампы 1. Взаимоиндукция: изменяющийся ток I₁ наводит ЭДС во второй катушке
            ЭДС₂=−M·dI₁/dt, наибольшую в момент включения и спадающую к нулю, когда ток перестаёт меняться.
          </>
        )
      }
    />
  );
}
