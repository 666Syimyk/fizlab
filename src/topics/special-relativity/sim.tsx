import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stars, Trail } from "@react-three/drei";
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
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ground, Tree } from "@/components/sim/props/environment";
import { badgeTexture, tapeTexture } from "@/components/sim/props/textures";

const C_SIM = 3;
const X_MIN = -6;
const X_MAX = 6;
const TRACK = X_MAX - X_MIN;
const Y0 = 0.6;
const V_SCALE = 1.4;

function triWave(t: number, T: number, d: number) {
  if (T <= 0) return -d;
  const u = (t / (T / 2)) % 2;
  const tri = u <= 1 ? u : 2 - u;
  return -d + 2 * d * tri;
}

interface SamplePoint {
  t: number;
  ticksStationary: number;
  ticksMoving: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  ticksStationary: number;
  ticksMoving: number;
}

interface SceneContentProps {
  beta: number;
  d: number;
  L0: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/** spaceship hull of proper length L along x, centred on the origin */
function Spaceship({ L }: { L: number }) {
  const r = 0.28;
  const hull = <meshStandardMaterial color="#e5e7eb" metalness={0.6} roughness={0.3} />;
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, L * 0.7, 24]} />
        {hull}
      </mesh>
      <mesh position={[L * 0.35 + L * 0.075, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <coneGeometry args={[r, L * 0.15, 24]} />
        {hull}
      </mesh>
      <mesh position={[-L * 0.35 - 0.06, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r * 0.75, r * 0.55, 0.14, 20]} />
        <meshStandardMaterial color="#52525b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[-L * 0.35 - 0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[r * 0.5, 0.45, 16]} />
        <meshStandardMaterial color="#fb923c" emissive="#f97316" emissiveIntensity={2} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => (
        <mesh key={a} position={[-L * 0.28, 0, 0]} rotation={[a, 0, 0]}>
          <boxGeometry args={[L * 0.16, 0.02, r * 2.4]} />
          <meshStandardMaterial color="#1d4ed8" metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
      {[-0.15, 0.05, 0.25].map((f) => (
        <mesh key={f} position={[L * f, 0.1, r * 0.98]}>
          <circleGeometry args={[0.055, 16]} />
          <meshStandardMaterial color="#1e3a5f" emissive="#38bdf8" emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function SceneContent({ beta, d, L0, running, speed, onSample, onLive }: SceneContentProps) {
  const [lap, setLap] = useState(0);
  const lapRef = useRef(0);
  const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-6));
  const v = beta * C_SIM;
  const T0 = (2 * d) / C_SIM;
  const T = gamma * T0;
  const Lbox = L0 / gamma;

  const rocketRef = useRef<THREE.Group>(null!);
  const hullRef = useRef<THREE.Group>(null!);
  const photonMovRef = useRef<THREE.Mesh>(null!);
  const photonStatRef = useRef<THREE.Mesh>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);

  const handleFrame = useCallback(
    (t: number) => {
      const x = ((v * t - X_MIN) % TRACK + TRACK) % TRACK + X_MIN;
      // restart the photon trail each time the ship wraps around the track
      const lapNow = Math.floor((v * t - X_MIN) / TRACK);
      if (lapNow !== lapRef.current) {
        lapRef.current = lapNow;
        setLap(lapNow);
      }
      if (rocketRef.current) rocketRef.current.position.set(x, Y0, 0);
      if (photonMovRef.current) photonMovRef.current.position.set(x, Y0 + triWave(t, T, d), 0.55);
      if (photonStatRef.current) photonStatRef.current.position.set(X_MIN - 1.6, Y0 + triWave(t, T0, d), 0.55);
      vArrow.current?.set([x, Y0 + d + 0.4, 0], [beta * V_SCALE, 0, 0]);
    },
    [v, T, T0, d, beta],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const ticksStationary = t / T0;
          const ticksMoving = t / T;
          onSample({ t, ticksStationary, ticksMoving });
          onLive({ t, ticksStationary, ticksMoving });
        }}
      />

      <mesh position={[0, Y0 - 1.9, 0]} receiveShadow>
        <boxGeometry args={[TRACK + 4, 0.05, 3]} />
        <meshStandardMaterial color="#141417" roughness={0.95} />
      </mesh>

      <Stars radius={70} depth={30} count={1500} factor={2.5} fade speed={0.3} />
      {/* ghost reference outline: the ship's proper length L0 */}
      <mesh position={[0, Y0 - d - 0.9, -0.6]}>
        <boxGeometry args={[L0, 0.3, 0.3]} />
        <meshBasicMaterial color="#a1a1aa" wireframe />
      </mesh>
      <SceneLabel position={[0, Y0 - d - 1.35, -0.6]}>собственная длина корабля L₀</SceneLabel>

      {/* moving ship with a light clock (glass tube with two mirrors) on board */}
      <group ref={rocketRef}>
        <group ref={hullRef} scale={[Lbox / L0, 1, 1]}>
          <Spaceship L={L0} />
        </group>
        <mesh position={[0, 0, 0.55]}>
          <cylinderGeometry args={[0.16, 0.16, 2 * d, 16, 1, true]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[0, d, 0.55]}>
          <boxGeometry args={[0.7, 0.06, 0.3]} />
          <meshStandardMaterial color="#d4d4d8" metalness={1} roughness={0.08} />
        </mesh>
        <mesh position={[0, -d, 0.55]}>
          <boxGeometry args={[0.7, 0.06, 0.3]} />
          <meshStandardMaterial color="#d4d4d8" metalness={1} roughness={0.08} />
        </mesh>
        <SceneLabel position={[0, d + 0.4, 0]}>корабль со световыми часами</SceneLabel>
      </group>
      <Trail key={lap} width={3} length={14} color="#fbbf24" attenuation={(w) => w} target={photonMovRef}>
        <mesh ref={photonMovRef} castShadow>
          <sphereGeometry args={[0.09, 14, 14]} />
          <meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={2} toneMapped={false} />
        </mesh>
      </Trail>

      {/* stationary reference light clock */}
      <mesh position={[X_MIN - 1.6, Y0 + d, 0.55]}>
        <boxGeometry args={[0.7, 0.06, 0.06]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.6} />
      </mesh>
      <mesh position={[X_MIN - 1.6, Y0 - d, 0.55]}>
        <boxGeometry args={[0.7, 0.06, 0.06]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.6} />
      </mesh>
      <mesh position={[X_MIN - 1.6, Y0, 0.55]}>
        <cylinderGeometry args={[0.16, 0.16, 2 * d, 16, 1, true]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[X_MIN - 1.6, Y0, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 0.4, 20]} />
        <meshStandardMaterial color="#5eead4" metalness={0.4} roughness={0.4} />
        <SceneLabel position={[0, d + 0.75, 0]}>часы на станции (не движутся)</SceneLabel>
      </mesh>
      <mesh ref={photonStatRef} castShadow>
        <sphereGeometry args={[0.09, 14, 14]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={1} />
      </mesh>

      <VectorArrow ref={vArrow} color="#4ade80" />
    </>
  );
}

const C_REAL = 3e8;
const MUON_H = 10000; // m
const MUON_TAU = 2.2e-6; // s, proper mean lifetime
const MUON_VIS_H = 8; // visual scene units for the 10 km column
const FALL_T = 4; // seconds, illustrative animation duration (real transit is ~33 microseconds)

interface MuonLive {
  t: number;
  classicalAlive: boolean;
  relativisticAlive: boolean;
  classicalFracFallen: number;
  relativisticFracFallen: number;
}

function SceneMuons({
  beta,
  running,
  speed,
  onLive,
  onFinished,
}: {
  beta: number;
  running: boolean;
  speed: number;
  onLive: (n: MuonLive) => void;
  onFinished: () => void;
}) {
  const v = beta * C_REAL;
  const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-6));
  const classicalRange = v * MUON_TAU; // m, mean distance before decay, no relativity
  const dilatedLifetime = gamma * MUON_TAU;
  const relativisticRange = v * dilatedLifetime; // m, mean distance before decay, with time dilation

  const classicalFracAtDecay = Math.min(1, classicalRange / MUON_H);
  const relativisticFracAtDecay = Math.min(1, relativisticRange / MUON_H);

  const classicalRef = useRef<THREE.Group>(null!);
  const relativisticRef = useRef<THREE.Group>(null!);
  const burst = useRef<THREE.Mesh>(null!);
  const finishedRef = useRef(false);
  const mu = useMemo(() => badgeTexture("μ", "#7c3aed"), []);
  const altitude = useMemo(() => tapeTexture(0, 10, 1), []);

  const handleFrame = useCallback(
    (t: number) => {
      const frac = Math.min(1, t / FALL_T);
      const classicalAlive = frac < classicalFracAtDecay;
      const relativisticAlive = frac < relativisticFracAtDecay;
      const yTop = MUON_VIS_H;

      if (classicalRef.current) {
        const cf = Math.min(frac, classicalFracAtDecay);
        classicalRef.current.position.y = yTop * (1 - cf);
        classicalRef.current.visible = classicalAlive;
      }
      if (burst.current) {
        // a short flash where the "classical" muon decays
        const since = (frac - classicalFracAtDecay) * FALL_T;
        const show = !classicalAlive && since < 0.8;
        burst.current.visible = show;
        burst.current.position.set(-1.2, yTop * (1 - classicalFracAtDecay), 0);
        if (show) {
          burst.current.scale.setScalar(0.2 + since * 1.2);
          (burst.current.material as THREE.MeshBasicMaterial).opacity = 1 - since / 0.8;
        }
      }
      if (relativisticRef.current) {
        const rf = Math.min(frac, relativisticFracAtDecay);
        relativisticRef.current.position.y = yTop * (1 - rf);
        relativisticRef.current.visible = relativisticAlive;
      }

      if (!finishedRef.current && frac >= 1) {
        finishedRef.current = true;
        onFinished();
      }
    },
    [classicalFracAtDecay, relativisticFracAtDecay, onFinished],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const frac = Math.min(1, t / FALL_T);
          onLive({
            t,
            classicalAlive: frac < classicalFracAtDecay,
            relativisticAlive: frac < relativisticFracAtDecay,
            classicalFracFallen: Math.min(frac, classicalFracAtDecay),
            relativisticFracFallen: Math.min(frac, relativisticFracAtDecay),
          });
        }}
      />

      <Ground kind="grass" from={-8} to={8} width={8} tile={4} tileZ={4} y={-0.01} />
      <Tree position={[-4.5, 0, -2.5]} height={1.4} seed={4} conifer />
      <Tree position={[4.2, 0, -2.2]} height={1.2} seed={7} />
      {/* the atmosphere: a tall translucent column of air */}
      <mesh position={[0, MUON_VIS_H / 2, -1.6]}>
        <planeGeometry args={[7, MUON_VIS_H]} />
        <meshBasicMaterial color="#1e40af" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {/* altitude scale 0–10 km */}
      <mesh position={[-2.6, MUON_VIS_H / 2, -1.2]} rotation={[0, 0, Math.PI / 2]}>
        <planeGeometry args={[MUON_VIS_H, 0.35]} />
        <meshStandardMaterial map={altitude} roughness={0.7} />
      </mesh>
      <SceneLabel position={[-2.6, MUON_VIS_H + 0.35, -1.2]}>высота, км</SceneLabel>
      {/* cosmic ray hitting the top of the atmosphere */}
      <mesh position={[0, MUON_VIS_H + 0.25, 0]}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color="#fde047" emissive="#fbbf24" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <SceneLabel position={[0, MUON_VIS_H + 0.75, 0]}>космический луч → рождаются мюоны</SceneLabel>
      {/* muon detector on the ground */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[3.4, 0.5, 1.2]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.51, 0]}>
        <boxGeometry args={[3.2, 0.02, 1.0]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.5} />
      </mesh>
      <SceneLabel position={[0, 0.85, 0.9]}>детектор мюонов на земле</SceneLabel>

      <group ref={classicalRef} position={[-1.2, MUON_VIS_H, 0]}>
        <sprite scale={0.38}>
          <spriteMaterial map={mu} color="#fecaca" />
        </sprite>
        <SceneLabel position={[0, 0.4, 0]} tone="#f87171">без теории относительности</SceneLabel>
      </group>
      <mesh ref={burst} visible={false}>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshBasicMaterial color="#f87171" transparent opacity={0.8} depthWrite={false} />
      </mesh>

      <group ref={relativisticRef} position={[1.2, MUON_VIS_H, 0]}>
        <sprite scale={0.38}>
          <spriteMaterial map={mu} color="#bbf7d0" />
        </sprite>
        <SceneLabel position={[0, 0.4, 0]} tone="#4ade80">с замедлением времени</SceneLabel>
      </group>
    </>
  );
}

export function SpecialRelativitySim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, beta, d, L0, betaMuon } = useControls("Специальная теория относительности", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Световые часы на корабле": "abstract", "Мюоны из космоса": "muon" },
    },
    beta: { value: 0.6, min: 0.05, max: 0.95, step: 0.01, label: "β = v/c", render: (get) => get("Специальная теория относительности.scenario") === "abstract" },
    d: { value: 0.6, min: 0.3, max: 1, step: 0.05, label: "d, м (разнос зеркал)", render: (get) => get("Специальная теория относительности.scenario") === "abstract" },
    L0: { value: 2, min: 1, max: 3.5, step: 0.1, label: "L₀, м (собств. длина)", render: (get) => get("Специальная теория относительности.scenario") === "abstract" },
    betaMuon: { value: 0.998, min: 0.99, max: 0.9999, step: 0.0001, label: "β мюона = v/c", render: (get) => get("Специальная теория относительности.scenario") === "muon" },
  });

  const muon = scenario === "muon";
  const gammaMuon = 1 / Math.sqrt(Math.max(1 - betaMuon * betaMuon, 1e-8));
  const [muonLive, setMuonLive] = useState<MuonLive>({ t: 0, classicalAlive: true, relativisticAlive: true, classicalFracFallen: 0, relativisticFracFallen: 0 });

  const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-6));
  const T0 = (2 * d) / C_SIM;
  const T = gamma * T0;
  const L = L0 / gamma;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, ticksStationary: 0, ticksMoving: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, ticksStationary: 0, ticksMoving: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);
  const handleFinished = useCallback(() => clock.pause(), [clock]);

  const resetState = useCallback(() => {
    setLive({ t: 0, ticksStationary: 0, ticksMoving: 0 });
    setSeries([{ t: 0, ticksStationary: 0, ticksMoving: 0 }]);
    setMuonLive({ t: 0, classicalAlive: true, relativisticAlive: true, classicalFracFallen: 0, relativisticFracFallen: 0 });
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const paramKey = `${scenario}|${beta}|${d}|${L0}|${betaMuon}`;
  const firstParams = useRef(paramKey);
  useEffect(() => {
    if (firstParams.current === paramKey) return;
    firstParams.current = paramKey;
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  const v = betaMuon * C_REAL;
  const classicalRange = v * MUON_TAU;
  const relativisticRange = v * gammaMuon * MUON_TAU;

  const stage = muon
    ? { camera: { position: [3.5, 5, 12] as [number, number, number], fov: 55 }, orbitTarget: [0, 4, 0] as [number, number, number] }
    : { camera: { position: [-1.2, 1.2, 8.6] as [number, number, number], fov: 50 }, orbitTarget: [-1.2, 0.5, 0] as [number, number, number] };

  let caption;
  let legend: LegendItem[];
  if (muon) {
    caption = muonLive.relativisticFracFallen >= 0.999 ? (
      <>
        <b>Детектор поймал мюон!</b> Без теории относительности мюон распался бы, пролетев ~{classicalRange.toFixed(0)} м. Но для нас его часы идут в γ = {gammaMuon.toFixed(1)} раз медленнее, и он
        живёт достаточно, чтобы пролететь все 10 км.
      </>
    ) : !muonLive.classicalAlive ? (
      <>
        <b>Красный мюон распался</b> через 2,2 мкс своего времени — на высоте ~{(10 - (classicalRange / 1000)).toFixed(1).replace(".", ",")} км. Зелёный летит дальше: его время замедлено в {gammaMuon.toFixed(1)} раз.
      </>
    ) : (
      <>Космический луч на высоте 10 км породил мюоны. Они летят к земле почти со скоростью света, но живут всего 2,2 мкс. Успеют ли долететь? (Падение сильно замедлено.)</>
    );
    legend = [
      { color: "#f87171", label: "мюон по классической физике", kind: "dot" },
      { color: "#4ade80", label: "мюон с замедлением времени", kind: "dot" },
    ];
  } else {
    caption = (
      <>
        Внутри корабля свет просто ходит вверх-вниз. Но со станции видно, что фотон летит <b>по диагонали</b> (жёлтый зигзаг): путь длиннее, а скорость света та же — поэтому «тик» корабельных часов
        длится в γ = {gamma.toFixed(2).replace(".", ",")} раза дольше. А сам корабль короче своего контура L₀ в те же γ раз.
      </>
    );
    legend = [
      { color: "#fbbf24", label: "путь фотона (вид со станции)", kind: "line" },
      { color: "#4ade80", label: "скорость корабля" },
    ];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={stage.camera} orbitTarget={stage.orbitTarget} simplified={isMobile} maxDistance={30} minDistance={3} bloomThreshold={0.6} fogRange={muon ? [18, 50] : [40, 120]} contactShadows={muon}>
          {muon ? (
            <SceneMuons key={clock.resetNonce} beta={betaMuon} running={clock.running} speed={clock.speed} onLive={setMuonLive} onFinished={handleFinished} />
          ) : (
            <SceneContent key={clock.resetNonce} beta={beta} d={d} L0={L0} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        muon ? (
          <NumberReadouts
            items={[
              { label: "γ=1/√(1−β²)", value: gammaMuon.toFixed(2) },
              { label: "Собств. время жизни τ", value: "2.2", unit: "мкс" },
              { label: "«Растянутое» время жизни γτ", value: (gammaMuon * MUON_TAU * 1e6).toFixed(1), unit: "мкс" },
              { label: "Путь без релятивизма", value: classicalRange.toFixed(0), unit: "м", color: "#f87171" },
              { label: "Путь с замедлением времени", value: relativisticRange.toFixed(0), unit: "м", color: "#4ade80" },
              { label: "Высота атмосферы", value: "10 000", unit: "м" },
              { label: "Красный мюон", value: muonLive.classicalAlive ? "летит" : "распался", color: muonLive.classicalAlive ? "#f87171" : "#71717a" },
              { label: "Зелёный мюон", value: muonLive.relativisticAlive ? "летит" : "распался", color: "#4ade80" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "γ=1/√(1−β²)", value: gamma.toFixed(3) },
              { label: "T₀ (свой период)", value: T0.toFixed(2), unit: "с" },
              { label: "T=γT₀ (в лаб. системе)", value: T.toFixed(2), unit: "с" },
              { label: "L=L₀/γ (сжатие длины)", value: L.toFixed(2), unit: "м" },
              { label: "Тиков: неподв. / движ.", value: `${live.ticksStationary.toFixed(1)} / ${live.ticksMoving.toFixed(1)}` },
            ]}
          />
        )
      }
      graphs={
        muon ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Без учёта теории относительности мюон в среднем пролетает лишь {classicalRange.toFixed(0)} м —
            меньше 1/{Math.round(MUON_H / classicalRange)} высоты атмосферы — и почти никогда не долетал бы до
            земли (красная точка гаснет почти сразу). С учётом замедления времени тот же мюон в системе отсчёта
            Земли живёт в γ={gammaMuon.toFixed(1)} раз дольше и пролетает {relativisticRange.toFixed(0)} м —
            этого достаточно, чтобы долететь до поверхности (зелёная точка). Падение показано в замедленной,
            наглядной шкале времени — реальный пролёт занимает ~33 мкс.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Накопленные тики часов</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "ticksStationary", color: "#5eead4", label: "неподвижные" }, { key: "ticksMoving", color: "#7c6cf5", label: "движущиеся" }]} />
          </div>
        )
      }
      note={
        muon ? (
          <>
            Мюоны рождаются от столкновений космических лучей с атмосферой на высоте ≈10 км и имеют собственное
            время жизни τ≈2.2 мкс. Экспериментально на поверхности Земли регистрируется гораздо больше мюонов,
            чем предсказывает классическая физика — это прямое экспериментальное подтверждение замедления
            времени (в системе отсчёта самого мюона это же объясняется сокращением длины: атмосфера «сжимается»
            в γ раз).
          </>
        ) : (
          <>
            Фотон в световых часах летит по вертикали в собственной системе, но в лабораторной системе
            движущихся часов путь идёт по диагонали (длиннее), поэтому тик занимает больше времени: T=γT₀
            — замедление времени. Фиолетовый корабль физически короче серого контура L₀ в γ раз — сокращение
            длины. Скорость света в сцене намеренно уменьшена для наглядности; отношения β, γ — точные.
          </>
        )
      }
    />
  );
}
