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
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const A0_VIS = 1;
const N_POINTS = 140;
const RESAMPLE_HZ = 1.2;
/** older measurements stay on screen, like a long-exposure photo */
const ACC_MAX = 1400;

type Orbital = "1s" | "2s" | "2p";

const ORBITAL_INFO: Record<Orbital, { box: number; densMax: number; n: number; l: number }> = {
  "1s": { box: 5, densMax: 1.02, n: 1, l: 0 },
  "2s": { box: 11, densMax: 4.05, n: 2, l: 0 },
  "2p": { box: 9, densMax: 0.56, n: 2, l: 1 },
};

function radialDist(orbital: Orbital, rho: number) {
  if (orbital === "1s") return rho * rho * Math.exp(-2 * rho);
  if (orbital === "2s") return rho * rho * Math.pow(2 - rho, 2) * Math.exp(-rho);
  return Math.pow(rho, 4) * Math.exp(-rho);
}

function density(orbital: Orbital, x: number, y: number, z: number) {
  const r = Math.hypot(x, y, z);
  const rho = r / A0_VIS;
  if (orbital === "1s") return Math.exp(-2 * rho);
  if (orbital === "2s") return Math.pow(2 - rho, 2) * Math.exp(-rho);
  const cosT = r > 1e-6 ? z / r : 0;
  return rho * rho * Math.exp(-rho) * cosT * cosT;
}

function sampleOrbital(orbital: Orbital, n: number): { x: number; y: number; z: number }[] {
  const info = ORBITAL_INFO[orbital];
  const pts: { x: number; y: number; z: number }[] = [];
  let attempts = 0;
  while (pts.length < n && attempts < n * 60) {
    attempts++;
    const x = (Math.random() * 2 - 1) * info.box;
    const y = (Math.random() * 2 - 1) * info.box;
    const z = (Math.random() * 2 - 1) * info.box;
    const d = density(orbital, x, y, z);
    if (Math.random() * info.densMax < d) pts.push({ x, y, z });
  }
  return pts;
}

interface SceneContentProps {
  orbital: Orbital;
  running: boolean;
  speed: number;
  onCount: (count: number) => void;
}

const WARM = new THREE.Color("#f472b6");
const COOL = new THREE.Color("#60a5fa");
const VIOLET = new THREE.Color("#a78bfa");

function SceneContent({ orbital, running, speed, onCount }: SceneContentProps) {
  const instRef = useRef<THREE.InstancedMesh>(null!);
  const accRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const [initialPoints] = useState(() => sampleOrbital(orbital, N_POINTS));
  const pointsRef = useRef(initialPoints);
  const groupRef = useRef<THREE.Group>(null!);
  const accCount = useRef(0);
  const accNext = useRef(0);
  const pTex = useMemo(() => badgeTexture("+", "#dc2626"), []);
  useEffect(() => { onCount(pointsRef.current.length); }, [onCount]);

  /** colour of a point: for 2p the two lobes have opposite signs of ψ */
  const colorOf = useCallback((z: number) => (orbital === "2p" ? (z >= 0 ? WARM : COOL) : VIOLET), [orbital]);
  const accumulate = useCallback(
    (pts: { x: number; y: number; z: number }[]) => {
      const acc = accRef.current;
      if (!acc) return;
      for (const p of pts) {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(0.045);
        dummy.updateMatrix();
        acc.setMatrixAt(accNext.current, dummy.matrix);
        acc.setColorAt(accNext.current, colorOf(p.z));
        accNext.current = (accNext.current + 1) % ACC_MAX;
        accCount.current = Math.min(accCount.current + 1, ACC_MAX);
      }
      acc.count = accCount.current;
      acc.instanceMatrix.needsUpdate = true;
      if (acc.instanceColor) acc.instanceColor.needsUpdate = true;
    },
    [dummy, colorOf],
  );
  useEffect(() => accumulate(pointsRef.current), [accumulate]);

  const handleFrame = useCallback(
    (_t: number, dt: number) => {
      if (groupRef.current) groupRef.current.rotation.y += 0.12 * dt;
      const mesh = instRef.current;
      if (!mesh) return;
      const pts = pointsRef.current;
      for (let i = 0; i < N_POINTS; i++) {
        const p = pts[i];
        if (p) {
          dummy.position.set(p.x, p.y, p.z);
          dummy.scale.setScalar(0.085);
          mesh.setColorAt(i, colorOf(p.z));
        } else {
          dummy.position.set(0, -999, 0);
          dummy.scale.setScalar(0.0001);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    [dummy, colorOf],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={RESAMPLE_HZ}
        onSample={() => {
          pointsRef.current = sampleOrbital(orbital, N_POINTS);
          accumulate(pointsRef.current);
          onCount(pointsRef.current.length);
        }}
      />

      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.8} />
      </mesh>
      <sprite scale={0.16} renderOrder={2}>
        <spriteMaterial map={pTex} depthTest={false} transparent />
      </sprite>
      <SceneLabel position={[0, -0.45, 0]}>ядро (протон)</SceneLabel>

      <group ref={groupRef}>
        {/* bright dots: the latest batch of "measurements"; dim dots: all the earlier ones */}
        <instancedMesh ref={instRef} args={[undefined, undefined, N_POINTS]} frustumCulled={false}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.95} toneMapped={false} />
        </instancedMesh>
        <instancedMesh ref={accRef} args={[undefined, undefined, ACC_MAX]} frustumCulled={false}>
          <sphereGeometry args={[1, 6, 5]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} toneMapped={false} />
        </instancedMesh>
        {orbital === "2s" && (
          <mesh>
            <sphereGeometry args={[2 * A0_VIS, 40, 28]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )}
        {orbital === "2p" && (
          <mesh>
            <circleGeometry args={[ORBITAL_INFO["2p"].box * 0.55, 64]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
      {orbital === "2s" && <SceneLabel position={[2.1, 0.6, 0]}>узловая сфера: здесь электрона нет</SceneLabel>}
      {orbital === "2p" && <SceneLabel position={[3.2, 0.25, 0]}>узловая плоскость: здесь электрона нет</SceneLabel>}
      <SceneLabel position={[0, ORBITAL_INFO[orbital].box * 0.55, 0]}>{`электронное облако |ψ|² (орбиталь ${orbital})`}</SceneLabel>
    </>
  );
}

export function HydrogenAtomQuantumSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);
  const [pointCount, setPointCount] = useState(0);

  const { orbital } = useControls("Атом водорода: орбитали", {
    orbital: { value: "1s", options: { "1s (сферическая)": "1s", "2s (с узлом)": "2s", "2p (гантель)": "2p" }, label: "Орбиталь" },
  });
  const info = ORBITAL_INFO[orbital as Orbital];

  const radialCurve = useMemo(() => {
    const pts: { rho: number; P: number }[] = [];
    const maxRho = ORBITAL_INFO[orbital as Orbital].box;
    for (let i = 0; i <= 60; i++) {
      const rho = (maxRho * i) / 60;
      pts.push({ rho: Number(rho.toFixed(2)), P: Number(radialDist(orbital as Orbital, rho).toFixed(4)) });
    }
    return pts;
  }, [orbital]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const caption =
    orbital === "1s" ? (
      <>
        У электрона в атоме нет траектории. Каждая точка — одно «измерение»: где электрон нашли бы в этот миг. Тусклые точки остаются, как на фото с <b>длинной выдержкой</b>, — и складываются в облако.
        У основного состояния 1s оно круглое и гуще всего у ядра.
      </>
    ) : orbital === "2s" ? (
      <>
        Орбиталь 2s тоже круглая, но внутри неё есть <b>узловая сфера</b> (жёлтая), на которой электрон не бывает никогда: облако как матрёшка — шарик внутри и слой снаружи. Энергия выше, облако
        больше.
      </>
    ) : (
      <>
        Орбиталь 2p — <b>гантель</b> из двух лепестков: розовый и голубой показывают разный знак волны ψ. В плоскости между ними (жёлтая) электрона нет. Такие «лепестки» определяют, как атомы
        соединяются в молекулы.
      </>
    );
  const legend: LegendItem[] =
    orbital === "2p"
      ? [
          { color: "#f472b6", label: "лепесток ψ > 0", kind: "dot" },
          { color: "#60a5fa", label: "лепесток ψ < 0", kind: "dot" },
        ]
      : [{ color: "#a78bfa", label: "где находили электрон", kind: "dot" }];

  return (
    <SimShell
      scene={
        <SceneCanvas camera={{ position: [7, 5, 7] as [number, number, number], fov: 50 }} simplified={isMobile} maxDistance={24} minDistance={3} bloomThreshold={0.8} fogRange={[30, 60]}>
          <SceneContent key={`${clock.resetNonce}:${orbital}`} orbital={orbital as Orbital} running={clock.running} speed={clock.speed} onCount={setPointCount} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: "Главное квант. число n", value: info.n.toString() },
            { label: "Орбитальное число l", value: info.l.toString() },
            { label: "Eₙ = −13.6/n²", value: (-13.6 / (info.n * info.n)).toFixed(3), unit: "эВ" },
            { label: "Точек облака", value: pointCount.toString() },
          ]}
        />
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Радиальная функция распределения P(r) = r²|R(r)|²</p>
            <LiveChart data={radialCurve} xKey="rho" xType="number" xLabel="r/a₀" series={[{ key: "P", color: "#a78bfa", label: "P(r), отн.ед." }]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted-2">
            <p className="mb-2 font-medium">Форма облака</p>
            <ul className="flex flex-col gap-1.5">
              <li><span style={{ color: "#5eead4" }}>1s</span>: сферически симметрично, максимум плотности в центре, монотонно убывает как e^(−2r/a₀).</li>
              <li><span style={{ color: "#fbbf24" }}>2s</span>: сферически симметрично, но есть узловая сфера — вероятность равна нулю на r=2a₀.</li>
              <li><span style={{ color: "#a78bfa" }}>2p</span>: форма гантели вдоль оси z, узловая плоскость в экваторе (θ=90°).</li>
            </ul>
          </div>
        </div>
      }
      note={
        <>
          Облако точек — не траектории электрона, а распределение вероятности |ψ(r,θ)|²: яркие точки
          разыгрываются заново каждую секунду (метод Монте-Карло), тусклые — накопленные прошлые. Форма
          облака определяется квантовыми числами n, l: 1s сферически симметрична, 2p имеет форму гантели с
          узловой плоскостью — прямая визуализация решений уравнения Шрёдингера для атома водорода.
        </>
      }
    />
  );
}
