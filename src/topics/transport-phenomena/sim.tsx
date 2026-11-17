import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { ParticleInstances, type ParticleInstancesHandle } from "@/components/sim/ParticleInstances";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { initParticles, stepParticles, type GasParticle, type Bounds } from "@/lib/particleGas";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Burner, GlassVessel, Steam } from "@/components/sim/props/thermo";
import { Ground, LabBench } from "@/components/sim/props/environment";
import { woodTexture } from "@/components/sim/props/textures";

const RADIUS = 0.055;
const Y_LEVEL = 0.6;
const COLOR_A = "#7c6cf5";
const COLOR_B = "#fbbf24";

interface SamplePoint {
  t: number;
  fracA: number;
  fracB: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  fracA: number;
  fracB: number;
}

interface SceneContentProps {
  nPer: number;
  v0: number;
  L: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function makeParticles(nPer: number, v0: number, L: number): GasParticle[] {
  const leftBounds: Bounds = { xMin: -L / 2, xMax: 0, zMin: -L / 2, zMax: L / 2 };
  const rightBounds: Bounds = { xMin: 0, xMax: L / 2, zMin: -L / 2, zMax: L / 2 };
  return [...initParticles(nPer, leftBounds, v0, RADIUS), ...initParticles(nPer, rightBounds, v0, RADIUS)];
}

function SceneContent({ nPer, v0, L, perfume, running, speed, onSample, onLive }: SceneContentProps & { perfume: boolean }) {
  const bounds: Bounds = useMemo(() => ({ xMin: -L / 2, xMax: L / 2, zMin: -L / 2, zMax: L / 2 }), [L]);
  const [initialParticles] = useState(() => makeParticles(nPer, v0, L));
  const particlesRef = useRef<GasParticle[]>(initialParticles);
  const instHandle = useRef<ParticleInstancesHandle>(null);

  const handleFixedStep = useCallback(
    (dt: number) => {
      stepParticles(particlesRef.current, dt, bounds, { pairwise: true });
    },
    [bounds],
  );

  const handleFrame = useCallback(() => {
    instHandle.current?.sync(particlesRef.current, Y_LEVEL, (_p, i) => (i < nPer ? COLOR_A : COLOR_B));
  }, [nPer]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={10}
        onSample={(t) => {
          const arr = particlesRef.current;
          let aLeft = 0;
          let bRight = 0;
          for (let i = 0; i < nPer; i++) if (arr[i].x < 0) aLeft++;
          for (let i = nPer; i < arr.length; i++) if (arr[i].x >= 0) bRight++;
          const fracA = aLeft / nPer;
          const fracB = bRight / nPer;
          onSample({ t, fracA, fracB });
          onLive({ t, fracA, fracB });
        }}
      />

      {perfume ? (
        <>
          {/* a room seen from above: floor, walls and a perfume bottle in the left corner */}
          <Ground kind="parquet" from={-L / 2} to={L / 2} width={L} tile={1.2} tileZ={1.2} y={Y_LEVEL - 0.25} />
          {[
            [0, -L / 2 - 0.05, L + 0.2, 0.1],
            [0, L / 2 + 0.05, L + 0.2, 0.1],
            [-L / 2 - 0.05, 0, 0.1, L],
            [L / 2 + 0.05, 0, 0.1, L],
          ].map(([x, z, w, d], i) => (
            <mesh key={i} position={[x, Y_LEVEL + 0.05, z]}>
              <boxGeometry args={[w, 0.6, d]} />
              <meshStandardMaterial color="#e7e5e4" roughness={0.8} />
            </mesh>
          ))}
          <group position={[-L / 2 + 0.35, Y_LEVEL - 0.25, -L / 2 + 0.35]}>
            <mesh position={[0, 0.22, 0]}>
              <boxGeometry args={[0.32, 0.44, 0.2]} />
              <meshStandardMaterial color="#f9a8d4" transparent opacity={0.7} roughness={0.05} />
            </mesh>
            <mesh position={[0, 0.52, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.16, 14]} />
              <meshStandardMaterial color="#d4a017" metalness={0.9} roughness={0.25} />
            </mesh>
            <SceneLabel position={[0, 0.85, 0]}>флакон духов</SceneLabel>
          </group>
        </>
      ) : (
        <>
          <LabBench position={[0, Y_LEVEL - 0.3 - 0.9, 0]} length={Math.max(L + 2.4, 6)} depth={L + 1.4} height={0.9} />
          <GlassVessel position={[0, Y_LEVEL, 0]} size={[L, 0.5, L]} />
        </>
      )}
      <lineSegments position={[0, Y_LEVEL, 0]} visible={false}>
        <edgesGeometry args={[new THREE.BoxGeometry(L, L, L)]} />
        <lineBasicMaterial color="#3f3f46" />
      </lineSegments>
      <mesh position={[0, Y_LEVEL, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.03, L]} />
        <meshBasicMaterial color="#f8fafc" transparent opacity={0.35} />
      </mesh>

      <ParticleInstances ref={instHandle} count={nPer * 2} color="#ffffff" radius={RADIUS} emissiveIntensity={0.3} />
      <SceneLabel position={[-L / 4, Y_LEVEL + 0.7, L / 2 - 0.2]} tone={COLOR_A}>{perfume ? "молекулы духов" : "газ A"}</SceneLabel>
      <SceneLabel position={[L / 4, Y_LEVEL + 0.7, L / 2 - 0.2]} tone={COLOR_B}>{perfume ? "воздух комнаты" : "газ B"}</SceneLabel>
    </>
  );
}

const ROD_N = 24;
const ROD_LEN = 3.2;
const T_HOT = 100;
const T_ROOM = 22;
const ALPHA_METAL = 0.08;
const ALPHA_WOOD = 0.0008;

interface SpoonsLive {
  t: number;
  handleMetal: number;
  handleWood: number;
}

function tempColor(t: number, tMin: number, tMax: number) {
  const frac = Math.max(0, Math.min(1, (t - tMin) / (tMax - tMin)));
  const cold = new THREE.Color("#38bdf8");
  const hot = new THREE.Color("#f87171");
  return cold.clone().lerp(hot, frac);
}

function SceneSpoons({ running, speed, onLive }: { running: boolean; speed: number; onLive: (n: SpoonsLive) => void }) {
  const metalT = useRef<number[]>(new Array(ROD_N).fill(T_ROOM).map((v, i) => (i === 0 ? T_HOT : v)));
  const woodT = useRef<number[]>(new Array(ROD_N).fill(T_ROOM).map((v, i) => (i === 0 ? T_HOT : v)));
  const metalRefs = useRef<(THREE.Mesh | null)[]>([]);
  const woodRefs = useRef<(THREE.Mesh | null)[]>([]);
  const dx = ROD_LEN / (ROD_N - 1);

  const diffuse = useCallback((arr: number[], alpha: number, dt: number) => {
    const next = arr.slice();
    for (let i = 1; i < arr.length - 1; i++) {
      next[i] = arr[i] + (alpha * dt * (arr[i + 1] - 2 * arr[i] + arr[i - 1])) / (dx * dx);
    }
    next[0] = T_HOT;
    next[arr.length - 1] = next[arr.length - 2];
    return next;
  }, [dx]);

  const handleFixedStep = useCallback(
    (dt: number) => {
      metalT.current = diffuse(metalT.current, ALPHA_METAL, dt);
      woodT.current = diffuse(woodT.current, ALPHA_WOOD, dt);
    },
    [diffuse],
  );

  const handleFrame = useCallback(() => {
    for (let i = 0; i < ROD_N; i++) {
      const mm = metalRefs.current[i];
      if (mm) (mm.material as THREE.MeshStandardMaterial).color.copy(tempColor(metalT.current[i], T_ROOM, T_HOT));
      const wm = woodRefs.current[i];
      if (wm) (wm.material as THREE.MeshStandardMaterial).color.copy(tempColor(woodT.current[i], T_ROOM, T_HOT));
    }
  }, []);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        fixedDt={1 / 240}
        onFixedStep={handleFixedStep}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => onLive({ t, handleMetal: metalT.current[ROD_N - 1], handleWood: woodT.current[ROD_N - 1] })}
      />

      <LabBench position={[0, -2.25, 0]} length={5} depth={3} height={0.9} />
      <Burner position={[0, -1.35, 0]} power={1} />
      {/* steel pot with boiling water */}
      <mesh position={[0, -0.4, 0]}>
        <cylinderGeometry args={[1.15, 1.1, 0.95, 40, 1, true]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.86, 0]}>
        <cylinderGeometry args={[1.1, 1.1, 0.04, 40]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.12, 40]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.6} roughness={0.05} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 1.3, -0.1, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.16, 0.04, 8, 16, Math.PI]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
      ))}
      <Steam position={[0, 0, 0.2]} spread={0.7} height={1.8} />
      {/* spoon bowls in the water */}
      <mesh position={[-0.6, -0.45, -0.7]} scale={[1, 0.5, 1.4]}>
        <sphereGeometry args={[0.16, 16, 12]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.95} roughness={0.2} />
      </mesh>
      <mesh position={[0.6, -0.45, -0.7]} scale={[1, 0.5, 1.4]}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial map={woodTexture("light", 2)} roughness={0.8} />
      </mesh>
      <SceneLabel position={[0, 0.25, 1.3]}>кипяток, 100°C</SceneLabel>
      <SceneLabel position={[0, ROD_LEN + 0.15, -0.7]}>цвет ручки = температура (как на тепловизоре)</SceneLabel>

      {Array.from({ length: ROD_N }, (_, i) => (
        <mesh
          key={`m${i}`}
          ref={(m) => {
            metalRefs.current[i] = m;
          }}
          position={[-0.6, (ROD_LEN * i) / (ROD_N - 1) - 0.3, -0.7]}
        >
          <boxGeometry args={[0.12, dx * 1.05, 0.12]} />
          <meshStandardMaterial color="#38bdf8" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      <SceneLabel position={[-0.6, ROD_LEN - 0.1, -0.7]}>металлическая ложка</SceneLabel>

      {Array.from({ length: ROD_N }, (_, i) => (
        <mesh
          key={`w${i}`}
          ref={(m) => {
            woodRefs.current[i] = m;
          }}
          position={[0.6, (ROD_LEN * i) / (ROD_N - 1) - 0.3, -0.7]}
        >
          <boxGeometry args={[0.14, dx * 1.05, 0.14]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.8} />
        </mesh>
      ))}
      <SceneLabel position={[0.6, ROD_LEN - 0.1, -0.7]}>деревянная ложка</SceneLabel>
    </>
  );
}

export function TransportPhenomenaSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, nPer, T, L } = useControls("Явления переноса (диффузия)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Два газа в сосуде": "abstract", "Духи в комнате": "perfume", "Ложка в кипятке": "spoons" },
    },
    nPer: { value: 80, min: 30, max: 150, step: 5, label: "N частиц каждого сорта", render: (get) => get("Явления переноса (диффузия).scenario") !== "spoons" },
    T: { value: 300, min: 100, max: 600, step: 20, label: "T, усл.ед.", render: (get) => get("Явления переноса (диффузия).scenario") !== "spoons" },
    L: { value: 4.5, min: 3, max: 6, step: 0.25, label: "L, усл.ед. (размер сосуда)", render: (get) => get("Явления переноса (диффузия).scenario") !== "spoons" },
  });
  const spoons = scenario === "spoons";
  const v0 = 0.15 * Math.sqrt(T);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, fracA: 1, fracB: 1 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, fracA: 1, fracB: 1 }]);
  const [spoonsLive, setSpoonsLive] = useState<SpoonsLive>({ t: 0, handleMetal: T_ROOM, handleWood: T_ROOM });

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => ((prev[prev.length - 1]?.t ?? -1) >= p.t ? [p] : prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, fracA: 1, fracB: 1 });
    setSeries([{ t: 0, fracA: 1, fracB: 1 }]);
    setSpoonsLive({ t: 0, handleMetal: T_ROOM, handleWood: T_ROOM });
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const pct = (x: number) => (x * 100).toFixed(0);
  const caption = spoons ? (
    <>
      Обе ложки стоят в кипятке. Металл проводит тепло в сотни раз лучше дерева: ручка металлической ложки уже {spoonsLive.handleMetal.toFixed(0)} °C, а деревянной — всего{" "}
      {spoonsLive.handleWood.toFixed(0)} °C. Поэтому кухонные лопатки делают деревянными.
    </>
  ) : scenario === "perfume" ? (
    <>
      Флакон открыли в углу комнаты. Ветра нет, но молекулы духов, толкаясь с молекулами воздуха, сами разбредаются по комнате: слева их осталось {pct(live.fracA)}% — скоро запах
      будет везде поровну (50%).
    </>
  ) : (
    <>
      Перегородки нет: газы перемешиваются сами за счёт теплового движения. Доля «своих» молекул в каждой половине падает от 100% к 50% — сейчас {pct(live.fracA)}% и {pct(live.fracB)}%.
      Горячее — быстрее.
    </>
  );
  const legend: LegendItem[] = spoons
    ? [
        { color: "#38bdf8", label: "холодно", kind: "square" },
        { color: "#f87171", label: "горячо", kind: "square" },
      ]
    : [
        { color: COLOR_A, label: scenario === "perfume" ? "духи" : "газ A", kind: "dot" },
        { color: COLOR_B, label: scenario === "perfume" ? "воздух" : "газ B", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={spoons ? { position: [2.6, 2.2, 4.6], fov: 50 } : { position: [2.5, 5.2, 6.5], fov: 50 }} orbitTarget={spoons ? [0, 0.6, 0] : [0, Y_LEVEL, 0]} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          {spoons ? (
            <SceneSpoons key={clock.resetNonce} running={clock.running} speed={clock.speed} onLive={setSpoonsLive} />
          ) : (
            <SceneContent key={`${clock.resetNonce}:${nPer}:${v0}:${L}`} nPer={nPer} v0={v0} L={L} perfume={scenario === "perfume"} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        spoons ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: spoonsLive.t.toFixed(2), unit: "с" },
              { label: "Температура ручки (металл)", value: spoonsLive.handleMetal.toFixed(1), unit: "°C", color: "#f87171" },
              { label: "Температура ручки (дерево)", value: spoonsLive.handleWood.toFixed(1), unit: "°C", color: "#4ade80" },
              { label: "α_металл / α_дерево", value: (ALPHA_METAL / ALPHA_WOOD).toFixed(0), unit: "×" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: scenario === "perfume" ? "Доля духов слева" : "Доля A в левой половине", value: (live.fracA * 100).toFixed(1), unit: "%", color: "#7c6cf5" },
              { label: scenario === "perfume" ? "Доля воздуха справа" : "Доля B в правой половине", value: (live.fracB * 100).toFixed(1), unit: "%", color: "#fbbf24" },
              { label: "Равновесие (обе доли →)", value: "50", unit: "%" },
            ]}
          />
        )
      }
      graphs={
        spoons ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Температуропроводность металла в сотни раз выше, чем у дерева: тепло от кипятка добегает до вашей
            руки на металлической ложке за секунды, а деревянная ложка остаётся прохладной намного дольше —
            поэтому кухонную утварь для горячего делают из дерева или пластика.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Выравнивание концентраций (диффузия)</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "fracA", color: "#7c6cf5", label: "A слева, %" }, { key: "fracB", color: "#fbbf24", label: "B справа, %" }]} />
          </div>
        )
      }
      note={
        spoons ? (
          <>
            Теплопроводность подчиняется уравнению диффузии тепла ∂T/∂t=α·∂²T/∂x², где α — температуропроводность
            материала. У металлов α велика (свободные электроны быстро переносят энергию), у дерева — мала
            (плохой проводник тепла) — поэтому при одинаковой геометрии ложек их ручки нагреваются совершенно
            по-разному.
          </>
        ) : scenario === "perfume" ? (
          <>
            Молекулы духов (фиолетовые) сталкиваются с молекулами воздуха (жёлтые) и постепенно распространяются
            по всей комнате — тот же механизм диффузии, что переносит запах от флакона в дальний угол комнаты
            без всякого ветра, только за счёт теплового движения молекул.
          </>
        ) : (
          <>
            Диффузия — один из трёх явлений переноса (перенос массы; есть ещё перенос импульса — вязкость, и
            перенос энергии — теплопроводность). Частицы A и B стартуют разделёнными по половинам сосуда без
            перегородки: хаотическое тепловое движение и столкновения переносят частицы через границу, доля
            каждого сорта в «своей» половине стремится к 50% — газ перемешивается вдоль градиента концентрации
            (закон Фика), пока не достигнет равновесия.
          </>
        )
      }
    />
  );
}
