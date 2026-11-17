import { useCallback, useMemo, useRef, useState } from "react";
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
import { LabBench } from "@/components/sim/props/environment";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const C14_HALFLIFE = 5730; // years

const VISUAL_T_HALF = 2; // seconds of animation per half-life
const GRID = 10;
const N0 = GRID * GRID;
const N_FLY = 14;
const SAMPLE_C: THREE.Vector3Tuple = [-1.2, 0.95, 0];
const PROBE: THREE.Vector3Tuple = [1.6, 1.2, 0.2];

const ISOTOPE_LIST: { name: string; T: number; unit: string }[] = [
  { name: "Полоний-214", T: 164e-6, unit: "с" },
  { name: "Йод-131", T: 8.02, unit: "сут" },
  { name: "Кобальт-60", T: 5.27, unit: "лет" },
  { name: "Углерод-14", T: 5730, unit: "лет" },
  { name: "Радий-226", T: 1600, unit: "лет" },
];

interface SamplePoint {
  tau: number;
  Nsim: number;
  Ntheory: number;
  [key: string]: number;
}
interface LiveNumbers {
  tau: number;
  Nremaining: number;
  rate: number;
}

interface SceneContentProps {
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/* ---------- a radioactive sample and a Geiger counter ---------- */
function SceneContent({ running, speed, onSample, onLive }: SceneContentProps) {
  const instRef = useRef<THREE.InstancedMesh>(null!);
  const flyRef = useRef<THREE.InstancedMesh>(null!);
  const ledMat = useRef<THREE.MeshBasicMaterial>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);
  const flights = useRef<{ start: THREE.Vector3; t0: number; active: boolean }[]>(Array.from({ length: N_FLY }, () => ({ start: new THREE.Vector3(), t0: 0, active: false })));
  const nextFly = useRef(0);
  const lastTau = useRef(0);
  const lastClick = useRef(-10);
  const clicks = useRef<number[]>([]);

  const decayTaus = useMemo(() => Array.from({ length: N0 }, () => -Math.log2(Math.max(Math.random(), 1e-9))), []);

  const positions = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) pts.push([SAMPLE_C[0] + (i - (GRID - 1) / 2) * 0.2, SAMPLE_C[1], SAMPLE_C[2] + (j - (GRID - 1) / 2) * 0.2]);
    }
    return pts;
  }, []);
  const probe = useMemo(() => new THREE.Vector3(...PROBE), []);

  const handleFrame = useCallback(
    (t: number) => {
      const tau = t / VISUAL_T_HALF;
      const mesh = instRef.current;
      if (mesh) {
        for (let i = 0; i < N0; i++) {
          const decayed = decayTaus[i] < tau;
          // a nucleus that has just decayed sends a particle toward the counter
          if (decayed && decayTaus[i] >= lastTau.current) {
            const f = flights.current[nextFly.current];
            f.start.set(...positions[i]);
            f.t0 = t;
            f.active = true;
            nextFly.current = (nextFly.current + 1) % N_FLY;
          }
          dummy.position.set(...positions[i]);
          dummy.scale.setScalar(decayed ? 0.045 : 0.075);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, colorObj.set(decayed ? "#475569" : "#4ade80"));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      lastTau.current = tau;

      const fly = flyRef.current;
      if (fly) {
        flights.current.forEach((f, i) => {
          const u = (t - f.t0) / 0.45;
          if (f.active && u >= 1) {
            f.active = false;
            lastClick.current = t;
            clicks.current.push(t);
          }
          if (f.active) {
            dummy.position.copy(f.start).lerp(probe, Math.max(u, 0));
            dummy.scale.setScalar(0.05);
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          fly.setMatrixAt(i, dummy.matrix);
        });
        fly.instanceMatrix.needsUpdate = true;
      }
      if (ledMat.current) ledMat.current.color.set(t - lastClick.current < 0.08 ? "#fde047" : "#3f3f46");
    },
    [decayTaus, positions, dummy, colorObj, probe],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => {
          const tau = t / VISUAL_T_HALF;
          const Nremaining = decayTaus.filter((d) => d >= tau).length;
          clicks.current = clicks.current.filter((c) => t - c < 1);
          onSample({ tau, Nsim: Nremaining, Ntheory: N0 * Math.pow(2, -tau) });
          onLive({ tau, Nremaining, rate: clicks.current.length });
        }}
      />
      <LabBench position={[0, -0.9, 0]} length={5.6} depth={2.6} height={0.9} />

      {/* lead container with the sample; above it, the sample magnified to single nuclei */}
      <mesh position={[SAMPLE_C[0], 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.6, 0.5, 28]} />
        <meshStandardMaterial color="#52525b" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[SAMPLE_C[0], 0.51, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.03, 28]} />
        <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[SAMPLE_C[0], SAMPLE_C[1] - 0.06, 0]}>
        <boxGeometry args={[2.15, 0.03, 2.15]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.6} />
      </mesh>
      <SceneLabel position={[SAMPLE_C[0], SAMPLE_C[1] + 0.45, -0.9]}>образец (ядра показаны увеличенными)</SceneLabel>
      <instancedMesh ref={instRef} args={[undefined, undefined, N0]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#4ade80" emissiveIntensity={0.25} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={flyRef} args={[undefined, undefined, N_FLY]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#fde047" toneMapped={false} />
      </instancedMesh>

      {/* Geiger counter */}
      <group position={[1.9, 0, 0.3]}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.9, 0.6, 0.55]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.38, 0.28]}>
          <planeGeometry args={[0.6, 0.22]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        <mesh position={[0.3, 0.15, 0.28]}>
          <circleGeometry args={[0.05, 16]} />
          <meshBasicMaterial ref={ledMat} color="#3f3f46" toneMapped={false} />
        </mesh>
        <mesh position={[-0.3, 0.95, -0.1]} rotation={[0, 0, 0.8]}>
          <cylinderGeometry args={[0.07, 0.07, 0.8, 16]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
        </mesh>
        <SceneLabel position={[0, 1.4, 0]}>счётчик Гейгера: щелчок = распад</SceneLabel>
      </group>
    </>
  );
}

/* ---------- radiocarbon dating of a mummy ---------- */
function bandageTexture() {
  return canvasTexture("mummy-bandage", 256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#d6c7a1";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(120,98,60,0.55)";
    ctx.lineWidth = 6;
    for (let i = -h; i < w + h; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h * 0.6, h);
      ctx.stroke();
    }
  });
}

function SceneCarbonDating({ fraction, ageYears }: { fraction: number; ageYears: number }) {
  const nRemaining = Math.round(fraction * N0);
  const bandage = useMemo(() => bandageTexture(), []);
  const positions = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) pts.push([1.6 + (i - (GRID - 1) / 2) * 0.17, 1.35 + (j - (GRID - 1) / 2) * 0.17, -0.6]);
    }
    return pts;
  }, []);
  // scatter which of the nuclei have decayed (fixed pattern)
  const order = useMemo(() => {
    const idx = Array.from({ length: N0 }, (_, i) => i);
    let s = 7;
    for (let i = idx.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const rank = new Array<number>(N0);
    idx.forEach((v, k) => (rank[v] = k));
    return rank;
  }, []);
  const timelineX = (years: number) => -2.6 + Math.min(years / 20000, 1) * 5.2;

  return (
    <>
      <LabBench position={[0, -0.9, 0.3]} length={6.4} depth={2.8} height={0.9} />
      {/* open sarcophagus with the mummy */}
      <group position={[-1.6, 0, 0.4]}>
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={[2.3, 0.5, 0.95]} />
          <meshStandardMaterial color="#7c4a1e" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.505, 0]}>
          <boxGeometry args={[2.32, 0.02, 0.97]} />
          <meshStandardMaterial color="#d4a017" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.27, 1.5, 8, 20]} />
          <meshStandardMaterial map={bandage} roughness={0.9} />
        </mesh>
        <mesh position={[-0.98, 0.7, 0]}>
          <sphereGeometry args={[0.25, 20, 16]} />
          <meshStandardMaterial map={bandage} roughness={0.9} />
        </mesh>
        <SceneLabel position={[0, 1.3, 0]}>мумия: берём кусочек ткани на анализ</SceneLabel>
      </group>

      {/* the sample magnified: green = carbon-14 still left, grey = already turned into nitrogen-14 */}
      <mesh position={[1.6, 1.35, -0.66]}>
        <boxGeometry args={[1.9, 1.9, 0.04]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {positions.map((p, i) => {
        const alive = order[i] < nRemaining;
        return (
          <mesh key={i} position={p}>
            <sphereGeometry args={[alive ? 0.06 : 0.04, 10, 8]} />
            <meshStandardMaterial color={alive ? "#4ade80" : "#475569"} emissive={alive ? "#4ade80" : "#000000"} emissiveIntensity={alive ? 0.6 : 0} />
          </mesh>
        );
      })}
      <SceneLabel position={[1.6, 2.5, -0.6]}>{`проба под «микроскопом»: осталось ${Math.round(fraction * 100)} % углерода-14`}</SceneLabel>

      {/* timeline 0–20 000 years with the half-lives marked */}
      <mesh position={[0, 0.03, 1.45]}>
        <boxGeometry args={[5.3, 0.04, 0.14]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
      {[0, 5730, 11460, 17190].map((y) => (
        <group key={y} position={[timelineX(y), 0.08, 1.45]}>
          <mesh>
            <boxGeometry args={[0.03, 0.1, 0.2]} />
            <meshBasicMaterial color="#64748b" />
          </mesh>
          <SceneLabel position={[0, -0.05, 0.3]}>{y === 0 ? "сейчас" : `${y} лет`}</SceneLabel>
        </group>
      ))}
      <mesh position={[timelineX(ageYears), 0.2, 1.45]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.1, 0.22, 14]} />
        <meshBasicMaterial color="#4ade80" toneMapped={false} />
      </mesh>
      <SceneLabel position={[timelineX(ageYears), 0.55, 1.45]}>{`возраст ≈ ${Math.round(ageYears)} лет`}</SceneLabel>
    </>
  );
}

export function RadioactivitySim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, isotopeName, fractionPct } = useControls("Радиоактивный распад", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Образец и счётчик Гейгера": "abstract", "Углеродная датировка (мумия)": "dating" },
    },
    isotopeName: { value: "Йод-131", options: ISOTOPE_LIST.map((i) => i.name), label: "Изотоп", render: (get) => get("Радиоактивный распад.scenario") === "abstract" },
    fractionPct: { value: 50, min: 1, max: 99, step: 1, label: "Осталось C-14, % от нормы", render: (get) => get("Радиоактивный распад.scenario") === "dating" },
  });
  const isotope = ISOTOPE_LIST.find((i) => i.name === isotopeName)!;
  const lambda = Math.log(2) / isotope.T;
  const isDating = scenario === "dating";
  const fraction = fractionPct / 100;
  const ageYears = (-C14_HALFLIFE / Math.log(2)) * Math.log(fraction);

  const [live, setLive] = useState<LiveNumbers>({ tau: 0, Nremaining: N0, rate: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ tau: 0, Nsim: N0, Ntheory: N0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 300 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ tau: 0, Nremaining: N0, rate: 0 });
    setSeries([{ tau: 0, Nsim: N0, Ntheory: N0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const caption = isDating ? (
    <>
      Пока человек жил, в его теле была та же доля углерода-14, что и в воздухе. После смерти C-14 только распадается: за каждые 5730 лет его становится вдвое меньше. В пробе осталось{" "}
      {fractionPct} % — значит, прошло около <b>{Math.round(ageYears)} лет</b>.
    </>
  ) : (
    <>
      Каждое ядро распадается <b>случайно</b> — заранее не скажешь, какое следующее. Но вместе они подчиняются строгому закону: за каждый период полураспада распадается половина оставшихся. Поэтому
      счётчик Гейгера щёлкает всё реже: сейчас {live.rate} щелч./с, осталось {live.Nremaining} из {N0} ядер.
    </>
  );
  const legend: LegendItem[] = isDating
    ? [
        { color: "#4ade80", label: "углерод-14 ещё есть", kind: "dot" },
        { color: "#475569", label: "уже распался", kind: "dot" },
      ]
    : [
        { color: "#4ade80", label: "нераспавшееся ядро", kind: "dot" },
        { color: "#475569", label: "распавшееся", kind: "dot" },
        { color: "#fde047", label: "вылетевшая частица", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isDating ? { position: [0, 2.8, 6.4] as [number, number, number], fov: 50 } : { position: [0.3, 3.0, 5.4] as [number, number, number], fov: 50 }}
          orbitTarget={isDating ? [0, 0.9, 0.2] : [0.2, 0.8, 0]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isDating ? (
            <SceneCarbonDating key={clock.resetNonce} fraction={fraction} ageYears={ageYears} />
          ) : (
            <SceneContent key={clock.resetNonce} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isDating ? (
          <NumberReadouts
            items={[
              { label: "T½ (C-14)", value: C14_HALFLIFE.toString(), unit: "лет" },
              { label: "Осталось C-14", value: fractionPct.toString(), unit: "% от нормы" },
              { label: "Возраст t = −(T½/ln2)·ln(N/N₀)", value: ageYears.toFixed(0), unit: "лет", color: "#4ade80" },
              { label: "Пример", value: ageYears > 4000 ? "старше пирамид Египта" : ageYears > 2000 ? "римская эпоха" : "средневековье и позже" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "T½ (реальный период полураспада)", value: isotope.T.toString(), unit: isotope.unit },
              { label: "λ = ln2/T½", value: lambda.toExponential(3), unit: `1/${isotope.unit}` },
              { label: "Прошло периодов τ=t/T½", value: live.tau.toFixed(2) },
              { label: "Осталось ядер N", value: `${live.Nremaining} / ${N0}` },
              { label: "Щелчков счётчика", value: live.rate.toString(), unit: "в секунду" },
            ]}
          />
        )
      }
      graphs={
        isDating ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Пока организм жив, он постоянно обменивается углеродом со средой, и доля радиоактивного C-14
            в нём поддерживается на постоянном атмосферном уровне. После смерти обмен прекращается, и C-14
            начинает распадаться с периодом полураспада 5730 лет, не восполняясь. Измерив, какая доля C-14
            осталась в образце сегодня, по формуле N(t)=N₀·e^(−λt) можно точно вычислить, сколько лет
            прошло с момента смерти — так датируют мумии, папирусы, кости мамонтов и другие органические
            находки.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">N(τ)/N₀=2^(−τ): симуляция (точки) vs теория (линия)</p>
            <LiveChart data={series} xKey="tau" xLabel="τ = t/T½" series={[{ key: "Nsim", color: "#4ade80", label: "N симуляция" }, { key: "Ntheory", color: "#fbbf24", label: "N теория" }]} />
          </div>
        )
      }
      note={
        isDating ? (
          <>
            Радиоуглеродный метод надёжно работает для находок возрастом примерно до 50 000 лет (после
            десятка периодов полураспада C-14 остаётся слишком мало для точного измерения). Для более
            древних пород используют изотопы с гораздо большим периодом полураспада — например, уран-238
            (T½≈4.5 млрд лет) для датировки самих горных пород и возраста Земли.
          </>
        ) : (
          <>
            Каждое ядро распадается случайно и независимо — момент распада нельзя предсказать для отдельного
            ядра, но для большого ансамбля среднее число оставшихся ядер точно следует закону N(t)=N₀·2^(−t/T½).
            Анимация идёт в единицах периода полураспада τ=t/T½, поэтому одинакова для любого изотопа —
            реальный T½ показан в панели чисел (для короткоживущих изотопов — микросекунды, для Ra-226 — тысячи
            лет).
          </>
        )
      }
    />
  );
}
