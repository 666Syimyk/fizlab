import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Coil, LightBulb, Resistor, Wire } from "@/components/sim/props/electric";
import { BulbSocket, CurrentFlow } from "@/components/sim/props/circuit";
import { LabBench } from "@/components/sim/props/environment";
import { canvasTexture, woodTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const STATIONS = [
  { name: "Станция А", f: 35 },
  { name: "Станция Б", f: 85 },
  { name: "Станция В", f: 160 },
];

/** one period of the current lasts this many seconds on screen (the real one is a few milliseconds) */
const SCREEN_PERIOD = 2;

interface SamplePoint {
  t: number;
  V: number;
  I: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  V: number;
  I: number;
}

type V3 = [number, number, number];

/* ---------- series RLC circuit on the bench ---------- */
const GEN_POS: V3 = [-2.2, 0, -0.3];
const G_PLUS: V3 = [-1.95, 0.15, 0.03];
const G_MINUS: V3 = [-2.45, 0.15, 0.03];
const COIL_C: V3 = [0.45, 0.3, 0.9];
const CAP_X = 1.9;
const BULB_P: V3 = [1.2, 0, -0.6];
// the loop, listed in the direction of positive current (from the generator's red terminal)
const W1: V3[] = [G_PLUS, [-1.95, 0.04, 0.9], [-1.46, 0.14, 0.9]];
const W2: V3[] = [[-0.34, 0.14, 0.9], [0.05, COIL_C[1], COIL_C[2] + 0.2]];
const W3: V3[] = [[0.85, COIL_C[1], COIL_C[2] + 0.2], [CAP_X, 0.04, 1.1], [CAP_X, 0.16, 0.55]];
const W4: V3[] = [[CAP_X, 0.16, -0.05], [CAP_X, 0.04, BULB_P[2]], [BULB_P[0] + 0.16, 0.06, BULB_P[2]]];
const W5: V3[] = [[BULB_P[0] - 0.16, 0.06, BULB_P[2]], [0.8, 0.04, -0.95], [-2.7, 0.04, -0.95], [-2.7, 0.04, 0.25], G_MINUS];
const BOARD: V3 = [0, 2.0, -1.6];

function generatorScreen(fHz: number) {
  return canvasTexture(`fgen-${fHz}`, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = "#04140c";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = h * 0.62 + Math.sin((x / w) * Math.PI * 4) * h * 0.22;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#86efac";
    ctx.font = "bold 34px monospace";
    ctx.fillText(`${fHz} Hz`, 12, 36);
  });
}

function FunctionGenerator({ fHz }: { fHz: number }) {
  const screen = useMemo(() => generatorScreen(fHz), [fHz]);
  return (
    <group position={GEN_POS}>
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[1.0, 0.6, 0.6]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[-0.12, 0.38, 0.302]}>
        <planeGeometry args={[0.6, 0.3]} />
        <meshStandardMaterial map={screen} emissive="#ffffff" emissiveMap={screen} emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      <mesh position={[0.34, 0.38, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.05, 20]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      {[0.25, -0.25].map((x, i) => (
        <mesh key={x} position={[x, 0.15, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.05, 14]} />
          <meshStandardMaterial color={i === 0 ? "#dc2626" : "#111827"} />
        </mesh>
      ))}
    </group>
  );
}

interface SceneContentProps {
  V0: number;
  I0: number;
  Ires: number;
  fHz: number;
  phi: number;
  VR: number;
  VL: number;
  VC: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ V0, I0, Ires, fHz, phi, VR, VL, VC, running, speed, onSample, onLive }: SceneContentProps) {
  const iArrow = useRef<VectorArrowHandle>(null);
  const vArrow = useRef<VectorArrowHandle>(null);
  const vrArrow = useRef<VectorArrowHandle>(null);
  const vlArrow = useRef<VectorArrowHandle>(null);
  const vcArrow = useRef<VectorArrowHandle>(null);
  const flow = useRef(0);
  const lamp = useRef(0);
  const scaleV = 1.0 / Math.max(V0, VL, VC, VR, 1e-6);

  useEffect(() => {
    if (!running) flow.current = 0;
  }, [running]);

  const handleFrame = useCallback(
    (t: number) => {
      // screen phase; the real time is t·(1/f)/SCREEN_PERIOD
      const base = (2 * Math.PI * t) / SCREEN_PERIOD;
      const o: V3 = [BOARD[0], BOARD[1], BOARD[2] + 0.06];
      const at = (ang: number, len: number): V3 => [Math.cos(ang) * len, Math.sin(ang) * len, 0];
      iArrow.current?.set(o, at(base, 0.9 * (I0 / Ires)));
      vArrow.current?.set(o, at(base + phi, V0 * scaleV));
      vrArrow.current?.set(o, at(base, VR * scaleV));
      vlArrow.current?.set(o, at(base + Math.PI / 2, VL * scaleV));
      vcArrow.current?.set(o, at(base - Math.PI / 2, VC * scaleV));
      const i = (I0 / Ires) * Math.cos(base);
      flow.current = i * 2.4 * speed;
      lamp.current = Math.min(i * i * 1.2, 1.5);
    },
    [phi, I0, Ires, V0, VR, VL, VC, scaleV, speed],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={30}
        onSample={(t) => {
          const base = (2 * Math.PI * t) / SCREEN_PERIOD;
          const V = V0 * Math.cos(base + phi);
          const I = I0 * Math.cos(base);
          const tReal = t / SCREEN_PERIOD / fHz;
          onSample({ t: Number((tReal * 1000).toFixed(2)), V, I });
          onLive({ t: tReal, V, I });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={6.4} depth={3.2} height={0.9} />
      <FunctionGenerator fHz={fHz} />
      <SceneLabel position={[GEN_POS[0], 0.95, GEN_POS[2]]}>генератор переменного тока</SceneLabel>

      <Resistor position={[-0.9, 0.14, 0.9]} ohms={10} />
      <SceneLabel position={[-0.9, 0.5, 0.9]}>R</SceneLabel>
      <Coil position={COIL_C} turns={10} radius={0.2} length={0.8} wire={0.03} />
      <mesh position={COIL_C} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.86, 18]} />
        <meshStandardMaterial color="#d6b98c" roughness={0.9} />
      </mesh>
      <SceneLabel position={[COIL_C[0], 0.72, COIL_C[2]]}>L (катушка)</SceneLabel>
      {/* electrolytic capacitor lying along z */}
      <group position={[CAP_X, 0.16, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.5, 24]} />
          <meshStandardMaterial color="#1e40af" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0, 0.151]}>
          <boxGeometry args={[0.05, 0.5, 0.004]} />
          <meshStandardMaterial color="#e0f2fe" />
        </mesh>
      </group>
      <SceneLabel position={[CAP_X + 0.1, 0.52, 0.25]}>C (конденсатор)</SceneLabel>
      <BulbSocket position={BULB_P} />
      <LightBulb position={[BULB_P[0], 0.12, BULB_P[2]]} brightnessRef={lamp} />
      <SceneLabel position={[BULB_P[0], 1.2, BULB_P[2]]}>лампа</SceneLabel>

      {[W1, W2, W3, W4, W5].map((p, i) => (
        <group key={i}>
          <Wire points={p} color={i === 0 ? "#dc2626" : "#1f2937"} radius={0.022} />
          <CurrentFlow points={p} count={Math.max(4, Math.round(p.length * 2.2))} speedRef={flow} radius={0.034} />
        </group>
      ))}

      {/* phasor diagram on a board behind the circuit */}
      <mesh position={BOARD}>
        <boxGeometry args={[2.9, 2.3, 0.06]} />
        <meshStandardMaterial color="#14532d" roughness={0.9} />
      </mesh>
      <mesh position={[BOARD[0], BOARD[1], BOARD[2] + 0.035]}>
        <ringGeometry args={[0.995, 1.005, 96]} />
        <meshBasicMaterial color="#a7f3d0" transparent opacity={0.5} />
      </mesh>
      <SceneLabel position={[BOARD[0], BOARD[1] + 1.35, BOARD[2]]}>векторная диаграмма (вращается с частотой тока)</SceneLabel>
      <VectorArrow ref={iArrow} color="#4ade80" />
      <VectorArrow ref={vArrow} color="#fbbf24" />
      <VectorArrow ref={vrArrow} color="#f87171" />
      <VectorArrow ref={vlArrow} color="#5eead4" />
      <VectorArrow ref={vcArrow} color="#38bdf8" />
    </>
  );
}

/* ---------- radio receiver tuned by a variable capacitor ---------- */
const F_MIN = 10;
const F_MAX = 200;

function dialTexture() {
  return canvasTexture("radio-dial", 512, 128, (ctx, w, h) => {
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#78350f";
    ctx.fillStyle = "#78350f";
    ctx.lineWidth = 2;
    for (let f = 20; f <= 200; f += 10) {
      const x = 16 + ((f - F_MIN) / (F_MAX - F_MIN)) * (w - 32);
      ctx.beginPath();
      ctx.moveTo(x, h * 0.55);
      ctx.lineTo(x, h * (f % 50 === 0 ? 0.28 : 0.4));
      ctx.stroke();
    }
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    for (const s of STATIONS) {
      const x = 16 + ((s.f - F_MIN) / (F_MAX - F_MIN)) * (w - 32);
      ctx.fillStyle = "#b91c1c";
      ctx.fillRect(x - 3, h * 0.55, 6, 14);
      ctx.fillText(s.name.replace("Станция ", ""), x, h * 0.92);
    }
    ctx.fillStyle = "#78350f";
    ctx.font = "16px sans-serif";
    ctx.fillText("Гц (условно)", w - 70, 20);
  });
}

function grilleTexture() {
  return canvasTexture("radio-grille", 256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#3b2a1a";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#a16207";
    ctx.lineWidth = 3;
    for (let y = 12; y < h; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  });
}

function SceneRadio({ fRes, CtuneUf, loudness, stationName, running, speed }: { fRes: number; CtuneUf: number; loudness: number; stationName: string; running: boolean; speed: number }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const dial = useMemo(() => dialTexture(), []);
  const grille = useMemo(() => grilleTexture(), []);
  const wood = useMemo(() => woodTexture("dark", 4), []);
  const phase = useRef(0);
  const pointerX = -0.403 + THREE.MathUtils.clamp((fRes - F_MIN) / (F_MAX - F_MIN), 0, 1) * 0.806;
  const rotorAngle = (1 - (CtuneUf - 10) / (300 - 10)) * Math.PI;

  const handleFrame = useCallback(
    (_t: number, dt: number) => {
      phase.current = (phase.current + dt * 0.8) % 1;
      rings.current.forEach((m, i) => {
        if (!m) return;
        const u = (phase.current + i / 3) % 1;
        m.scale.setScalar(0.4 + u * 1.6);
        (m.material as THREE.MeshBasicMaterial).opacity = loudness > 0.15 ? (1 - u) * 0.7 * loudness : 0;
      });
    },
    [loudness],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, 0]} length={5} depth={2.6} height={0.9} />

      {/* wooden radio set */}
      <group position={[-0.3, 0, 0]}>
        <mesh position={[0, 0.58, 0]} castShadow>
          <boxGeometry args={[1.9, 1.16, 0.7]} />
          <meshStandardMaterial map={wood} roughness={0.6} />
        </mesh>
        <mesh position={[-0.45, 0.62, 0.352]}>
          <circleGeometry args={[0.36, 40]} />
          <meshStandardMaterial map={grille} roughness={0.9} />
        </mesh>
        <mesh position={[0.45, 0.85, 0.352]}>
          <planeGeometry args={[0.86, 0.24]} />
          <meshStandardMaterial map={dial} emissive="#fde68a" emissiveIntensity={0.25} />
        </mesh>
        {/* tuning pointer */}
        <mesh position={[0.45 + pointerX, 0.85, 0.36]}>
          <boxGeometry args={[0.015, 0.24, 0.01]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
        {/* tuning knob, turned together with the capacitor */}
        <mesh position={[0.45, 0.42, 0.37]} rotation={[Math.PI / 2, rotorAngle, 0]}>
          <cylinderGeometry args={[0.12, 0.13, 0.08, 24]} />
          <meshStandardMaterial color="#1c1917" roughness={0.5} />
        </mesh>
        <mesh position={[0.45 + 0.09 * Math.sin(rotorAngle), 0.42 + 0.09 * Math.cos(rotorAngle), 0.415]} rotation={[0, 0, -rotorAngle]}>
          <boxGeometry args={[0.015, 0.05, 0.01]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
        <SceneLabel position={[0.45, 0.2, 0.5]}>ручка настройки</SceneLabel>
        {/* telescopic antenna */}
        <mesh position={[0.75, 1.16 + 0.7, -0.2]} rotation={[0, 0, -0.35]}>
          <cylinderGeometry args={[0.012, 0.02, 1.5, 8]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.9} roughness={0.2} />
        </mesh>
        <SceneLabel position={[1.1, 2.55, -0.2]}>антенна ловит все станции</SceneLabel>
        {/* sound coming out of the speaker */}
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(m) => {
              rings.current[i] = m;
            }}
            position={[-0.45, 0.62, 0.4]}
          >
            <torusGeometry args={[0.36, 0.012, 6, 48]} />
            <meshBasicMaterial color="#fde68a" transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
        <SceneLabel position={[-0.45, 1.45, 0.3]}>{loudness > 0.15 ? `играет: ${stationName}` : "шипение — станция не поймана"}</SceneLabel>
      </group>

      {/* the variable capacitor of the tuning circuit, shown next to the radio */}
      <group position={[1.75, 0, 0.2]}>
        <mesh position={[0, 0.04, 0]}>
          <boxGeometry args={[0.7, 0.08, 0.6]} />
          <meshStandardMaterial color="#e7e5e4" roughness={0.7} />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => (
          <group key={i} position={[0, 0.16 + i * 0.07, 0]}>
            <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.26, 32, 0, Math.PI]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.25} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, rotorAngle]}>
              <circleGeometry args={[0.24, 32, 0, Math.PI]} />
              <meshStandardMaterial color="#f59e0b" metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.6, 8]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
        </mesh>
        <SceneLabel position={[0, 0.95, 0]}>{`конденсатор настройки: ${CtuneUf} мкФ`}</SceneLabel>
      </group>
    </>
  );
}

export function AcCircuitsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, V0, f, R, Lmh, Cuf, CtuneUf } = useControls("Цепи переменного тока (RLC)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "RLC-цепь с лампой": "abstract", "Радиоприёмник: настройка на станцию": "radio" },
    },
    V0: { value: 20, min: 5, max: 40, step: 1, label: "V₀, В (амплитуда)", render: (get) => get("Цепи переменного тока (RLC).scenario") === "abstract" },
    f: { value: 50, min: 10, max: 200, step: 5, label: "f, Гц", render: (get) => get("Цепи переменного тока (RLC).scenario") === "abstract" },
    R: { value: 10, min: 1, max: 30, step: 1, label: "R, Ом" },
    Lmh: { value: 40, min: 5, max: 150, step: 5, label: "L, мГн" },
    Cuf: { value: 80, min: 10, max: 300, step: 10, label: "C, мкФ", render: (get) => get("Цепи переменного тока (RLC).scenario") === "abstract" },
    CtuneUf: { value: 150, min: 10, max: 300, step: 5, label: "настройка (конденсатор), мкФ", render: (get) => get("Цепи переменного тока (RLC).scenario") === "radio" },
  });
  const isRadio = scenario === "radio";

  const L = Lmh / 1000;
  const C = (isRadio ? CtuneUf : Cuf) / 1e6;

  const stationSignals = useMemo(
    () =>
      STATIONS.map((s) => {
        const w = 2 * Math.PI * s.f;
        const z = Math.sqrt(R * R + (w * L - 1 / (w * C)) * (w * L - 1 / (w * C)));
        return { ...s, I: 20 / z };
      }),
    [R, L, C],
  );
  const loudest = stationSignals.reduce((a, b) => (b.I > a.I ? b : a), stationSignals[0]);

  const fEff = isRadio ? loudest.f : f;
  const V0eff = isRadio ? 20 : V0;
  const omega = 2 * Math.PI * fEff;
  const XL = omega * L;
  const XC = 1 / (omega * C);
  const Z = Math.sqrt(R * R + (XL - XC) * (XL - XC));
  const phi = Math.atan2(XL - XC, R);
  const I0 = V0eff / Z;
  const VR = I0 * R;
  const VL = I0 * XL;
  const VC = I0 * XC;
  const fRes = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const Ires = V0eff / R;

  const curve = useMemo(() => {
    const pts: { fHz: number; Z: number }[] = [];
    for (let i = 0; i <= 50; i++) {
      const fi = 10 + (200 - 10) * (i / 50);
      const w = 2 * Math.PI * fi;
      const zi = Math.sqrt(R * R + (w * L - 1 / (w * C)) * (w * L - 1 / (w * C)));
      pts.push({ fHz: Number(fi.toFixed(1)), Z: Number(zi.toFixed(2)) });
    }
    return pts;
  }, [R, L, C]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, V: V0eff * Math.cos(phi), I: I0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, V: V0eff * Math.cos(phi), I: I0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 300 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, V: V0eff * Math.cos(phi), I: I0 });
    setSeries([{ t: 0, V: V0eff * Math.cos(phi), I: I0 }]);
  }, [V0eff, phi, I0]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const paramKey = `${scenario}|${V0}|${f}|${R}|${Lmh}|${Cuf}|${CtuneUf}`;
  const lastKey = useRef(paramKey);
  useEffect(() => {
    if (lastKey.current === paramKey) return;
    lastKey.current = paramKey;
    handleReset();
  }, [paramKey, handleReset]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const loudness = Math.min(loudest.I / (20 / R), 1);
  const nearRes = Math.abs(fEff - fRes) / fRes < 0.08;
  const caption = isRadio ? (
    <>
      Антенна ловит сигналы всех станций сразу. Контур из катушки L и конденсатора C внутри приёмника откликается только на свою частоту <b>f = 1/(2π√LC) = {fmt(fRes, 0)} Гц</b> — это резонанс.
      Крутите ручку (меняете C) — стрелка шкалы едет, и громче всех звучит станция, чья частота ближе: сейчас <b>{loudest.name}</b>.
    </>
  ) : (
    <>
      Генератор гонит ток то в одну, то в другую сторону — электроны в проводах качаются туда-сюда, лампа мигает. Катушка мешает току при высокой частоте, конденсатор — при низкой.{" "}
      {nearRes ? (
        <>
          Сейчас <b>резонанс</b> (f ≈ {fmt(fRes, 0)} Гц): их влияния гасят друг друга, ток максимален, лампа ярче всего.
        </>
      ) : (
        <>
          Резонанс будет при f = {fmt(fRes, 0)} Гц, а сейчас {f} Гц — ток {fmt((I0 / Ires) * 100, 0)} % от максимума.
        </>
      )}{" "}
      Показано замедленно: один период = {SCREEN_PERIOD} с.
    </>
  );
  const legend: LegendItem[] = isRadio
    ? [
        { color: "#dc2626", label: "стрелка настройки", kind: "line" },
        { color: "#fde68a", label: "звук из динамика", kind: "line" },
      ]
    : [
        { color: "#4ade80", label: "ток I" },
        { color: "#fbbf24", label: "напряжение V" },
        { color: "#f87171", label: "V на R" },
        { color: "#5eead4", label: "V на L" },
        { color: "#38bdf8", label: "V на C" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isRadio ? { position: [0.4, 1.9, 4.4] as [number, number, number], fov: 50 } : { position: [0.3, 3.0, 6.2] as [number, number, number], fov: 50 }}
          orbitTarget={isRadio ? [0.2, 0.8, 0] : [0, 0.9, -0.3]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={2.5}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isRadio ? (
            <SceneRadio key={clock.resetNonce} fRes={fRes} CtuneUf={CtuneUf} loudness={loudness} stationName={loudest.name} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent
              key={clock.resetNonce}
              V0={V0eff}
              I0={I0}
              Ires={Ires}
              fHz={fEff}
              phi={phi}
              VR={VR}
              VL={VL}
              VC={VC}
              running={clock.running}
              speed={clock.speed}
              onSample={handleSample}
              onLive={setLive}
            />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isRadio ? (
          <NumberReadouts
            items={[
              ...stationSignals.map((s) => ({
                label: `${s.name} (${s.f} Гц)`,
                value: s.I.toFixed(3),
                unit: "А (сила сигнала)",
                color: s.name === loudest.name ? "#4ade80" : undefined,
              })),
              { label: "Резонансная частота настройки", value: fRes.toFixed(1), unit: "Гц" },
              { label: "Слышна", value: loudest.name },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "V(t)", value: live.V.toFixed(2), unit: "В", color: "#fbbf24" },
              { label: "I(t)", value: live.I.toFixed(3), unit: "А", color: "#4ade80" },
              { label: "X_L = ωL", value: XL.toFixed(2), unit: "Ом", color: "#5eead4" },
              { label: "X_C = 1/ωC", value: XC.toFixed(2), unit: "Ом", color: "#38bdf8" },
              { label: "Z = √(R²+(X_L−X_C)²)", value: Z.toFixed(2), unit: "Ом" },
              { label: "φ (сдвиг фаз V относит. I)", value: ((phi * 180) / Math.PI).toFixed(1), unit: "°" },
              { label: "I₀ = V₀/Z", value: I0.toFixed(3), unit: "А", color: "#4ade80" },
            ]}
          />
        )
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">V(t) и I(t) — видно сдвиг фаз</p>
            <LiveChart data={series} xKey="t" xType="number" xLabel="t, мс" series={[{ key: "V", color: "#fbbf24", label: "V, В" }, { key: "I", color: "#4ade80", label: "I, А" }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Z(f) — резонанс при X_L=X_C</p>
            <LiveChart data={curve} xKey="fHz" xType="number" xLabel="f, Гц" series={[{ key: "Z", color: "#f87171", label: "Z, Ом" }]} />
          </div>
        </div>
      }
      note={
        isRadio ? (
          <>
            Антенна ловит сигналы всех станций сразу, но колебательный контур LC — избирательный фильтр:
            его сопротивление минимально (Z=√(R²+(X_L−X_C)²) наименьшее) на резонансной частоте
            f_рез=1/(2π√(LC)). Крутя ручку настройки, вы меняете ёмкость C конденсатора (поворачиваются
            его пластины), а вместе с ней и резонансную частоту — станция, чья частота ближе всего к
            резонансной, звучит громче всех. Частоты станций здесь условные: в настоящем радио это
            сотни килогерц и мегагерцы.
          </>
        ) : (
          <>
            Векторная диаграмма (фазоры) вращается с частотой ω: зелёный — ток I (опорная фаза), жёлтый —
            полное напряжение V, красный/бирюзовый/синий — напряжения на R/L/C. V_L опережает ток на 90°, V_C
            отстаёт на 90° — поэтому они вычитаются в полном сопротивлении Z=√(R²+(X_L−X_C)²). При X_L=X_C
            наступает резонанс: Z минимально, ток максимален. Настоящий ток меняется за миллисекунды, поэтому
            показан замедленно.
          </>
        )
      }
    />
  );
}
