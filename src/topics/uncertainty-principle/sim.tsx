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
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const N_SLIT_PARTICLES = 48;
const VIS_HBAR = 0.35;
const P0 = 1;
const PATH_LEN = 6;
const SLIT_SPEED = 2.2;

const HBAR = 1.0546e-34;
const N_BARS = 30;
const X_RANGE = 1.5;
const PERIOD = 10;
const N_WAVE = 140;

function gaussian(x: number, sigma: number) {
  return Math.exp(-(x * x) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
}

function sigmaXAt(t: number, sMin: number, sMax: number) {
  const frac = (t % PERIOD) / PERIOD;
  return sMin + (sMax - sMin) * (0.5 - 0.5 * Math.cos(2 * Math.PI * frac));
}

interface SamplePoint {
  t: number;
  sxN: number;
  spN: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  sx: number;
  sp: number;
  product: number;
}

interface SceneContentProps {
  sMin: number;
  sMax: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

const BOARD_Y = 1.5;
const LEFT_X = -1.8;
const RIGHT_X = 1.8;

function Board({ x, title }: { x: number; title: string }) {
  return (
    <group position={[x, BOARD_Y, -0.35]}>
      <mesh>
        <boxGeometry args={[3.3, 2.0, 0.06]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.75, 0.04]}>
        <boxGeometry args={[3.1, 0.015, 0.01]} />
        <meshBasicMaterial color="#64748b" />
      </mesh>
      <SceneLabel position={[0, 1.2, 0]}>{title}</SceneLabel>
    </group>
  );
}

/* ---------- a wave packet: narrow in x ⇔ wide in p, with a sound analogy ---------- */
function SceneContent({ sMin, sMax, running, speed, onSample, onLive }: SceneContentProps) {
  const barsXRef = useRef<THREE.InstancedMesh>(null!);
  const barsPRef = useRef<THREE.InstancedMesh>(null!);
  const waveRef = useRef<THREE.InstancedMesh>(null!);
  const forkMat = useRef<THREE.MeshStandardMaterial>(null!);
  const drumMat = useRef<THREE.MeshStandardMaterial>(null!);
  const prongs = useRef<(THREE.Mesh | null)[]>([]);
  const stick = useRef<THREE.Group>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const handleFrame = useCallback(
    (t: number) => {
      const sx = sigmaXAt(t, sMin, sMax);
      const sigmaXVis = 0.12 + sx * 0.45;
      const sigmaPVis = 0.12 + (1 / sx) * 0.12;
      const base = BOARD_Y - 0.74;

      const drawBars = (mesh: THREE.InstancedMesh | null, cx: number, sigma: number) => {
        if (!mesh) return;
        const peak = gaussian(0, sigma);
        for (let i = 0; i < N_BARS; i++) {
          const x = -X_RANGE + (2 * X_RANGE * i) / (N_BARS - 1);
          const h = Math.max(gaussian(x, sigma) / peak, 0.02) * 1.2;
          dummy.position.set(cx + x, base + h / 2, -0.28);
          dummy.scale.set(1, h, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      };
      drawBars(barsXRef.current, LEFT_X, sigmaXVis);
      drawBars(barsPRef.current, RIGHT_X, sigmaPVis);

      // the wave packet itself: ψ(x) = envelope × cos(k₀x − ωt), drawn in front of the "where" board
      const w = waveRef.current;
      if (w) {
        for (let i = 0; i < N_WAVE; i++) {
          const x = -X_RANGE + (2 * X_RANGE * i) / (N_WAVE - 1);
          const env = Math.exp(-(x * x) / (4 * sigmaXVis * sigmaXVis));
          dummy.position.set(LEFT_X + x, BOARD_Y + 0.25 + Math.cos(12 * x - 6 * t) * 0.35 * env, -0.2);
          dummy.scale.setScalar(0.022);
          dummy.updateMatrix();
          w.setMatrixAt(i, dummy.matrix);
        }
        w.instanceMatrix.needsUpdate = true;
      }

      // sound analogy: a long pure tone (tuning fork) vs a short knock (drum)
      const long = (sx - sMin) / (sMax - sMin || 1);
      if (forkMat.current) forkMat.current.emissiveIntensity = 0.1 + 0.9 * long;
      if (drumMat.current) drumMat.current.emissiveIntensity = 0.1 + 0.9 * (1 - long);
      prongs.current.forEach((p, i) => p && (p.position.x = (i === 0 ? -1 : 1) * (0.07 + Math.sin(t * 40) * 0.012 * long)));
      if (stick.current) stick.current.rotation.z = 0.5 + Math.max(0, Math.sin(t * 3)) * 0.6 * (1 - long);
    },
    [sMin, sMax, dummy],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={15}
        onSample={(t) => {
          const sx = sigmaXAt(t, sMin, sMax);
          const sp = HBAR / (2 * sx);
          onSample({ t, sxN: sx / sMax, spN: (sp * sMax) / (HBAR / 2) / 5 });
          onLive({ t, sx, sp, product: sx * sp });
        }}
      />
      <LabBench position={[0, -0.9, 0.3]} length={7.6} depth={2.4} height={0.9} />
      <Board x={LEFT_X} title="ГДЕ частица: волновой пакет и |ψ(x)|²" />
      <Board x={RIGHT_X} title="КАКОЙ импульс: разброс |φ(p)|²" />

      <instancedMesh ref={barsXRef} args={[undefined, undefined, N_BARS]} frustumCulled={false}>
        <boxGeometry args={[0.07, 1, 0.05]} />
        <meshBasicMaterial color="#4ade80" toneMapped={false} transparent opacity={0.75} />
      </instancedMesh>
      <instancedMesh ref={barsPRef} args={[undefined, undefined, N_BARS]} frustumCulled={false}>
        <boxGeometry args={[0.07, 1, 0.05]} />
        <meshBasicMaterial color="#f87171" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={waveRef} args={[undefined, undefined, N_WAVE]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial color="#fde68a" toneMapped={false} />
      </instancedMesh>

      {/* tuning fork: a long, pure tone */}
      <group position={[-1.0, 0, 0.9]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.4, 10]} />
          <meshStandardMaterial ref={forkMat} color="#cbd5e1" metalness={0.9} roughness={0.25} emissive="#fde68a" emissiveIntensity={0.3} />
        </mesh>
        {[0, 1].map((i) => (
          <mesh
            key={i}
            ref={(m) => {
              prongs.current[i] = m;
            }}
            position={[(i === 0 ? -1 : 1) * 0.07, 0.62, 0]}
          >
            <boxGeometry args={[0.04, 0.5, 0.04]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
          </mesh>
        ))}
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[0.18, 0.04, 0.04]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
        </mesh>
        <SceneLabel position={[0, 1.1, 0]}>камертон: долгий звук, одна частота</SceneLabel>
      </group>
      {/* drum: a short knock contains many frequencies */}
      <group position={[1.2, 0, 0.9]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.4, 28]} />
          <meshStandardMaterial ref={drumMat} color="#b91c1c" roughness={0.5} emissive="#f87171" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, 0.405, 0]}>
          <cylinderGeometry args={[0.31, 0.31, 0.01, 28]} />
          <meshStandardMaterial color="#f5f5f4" roughness={0.8} />
        </mesh>
        <group ref={stick} position={[0.45, 0.55, 0]} rotation={[0, 0, 0.5]}>
          <mesh position={[-0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.015, 0.02, 0.45, 8]} />
            <meshStandardMaterial color="#a16207" roughness={0.6} />
          </mesh>
        </group>
        <SceneLabel position={[0, 1.0, 0]}>барабан: короткий удар, много частот</SceneLabel>
      </group>
    </>
  );
}

/* ---------- a laser through an adjustable slit ---------- */
function SceneSlit({ w, running, speed }: { w: number; running: boolean; speed: number }) {
  const instRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const angleStd = VIS_HBAR / (2 * w * P0);
  const spotH = Math.min(2 * (w / 2 + 2.6 * angleStd * 3), 2.6);

  const bases = useMemo(() => {
    const arr: { u: number; g: number; phase: number }[] = [];
    for (let i = 0; i < N_SLIT_PARTICLES; i++) {
      const u1 = Math.max(Math.random(), 1e-6);
      const u2 = Math.random();
      const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      arr.push({ u: Math.random() - 0.5, g, phase: (i / N_SLIT_PARTICLES) * PATH_LEN });
    }
    return arr;
  }, []);

  const handleFrame = useCallback(
    (t: number) => {
      const mesh = instRef.current;
      if (!mesh) return;
      bases.forEach((b, i) => {
        const x = -3 + ((t * SLIT_SPEED + b.phase) % PATH_LEN);
        const y0 = b.u * w;
        const y = x < 0 ? y0 : y0 + b.g * angleStd * x;
        dummy.position.set(x, 1.0 + y, 0);
        dummy.scale.setScalar(0.04);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    [bases, w, angleStd, dummy],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, 0]} length={7.4} depth={2.2} height={0.9} />

      <group position={[-3.4, 1.0, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 0.7, 18]} />
          <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.5, 0]}>
          <boxGeometry args={[0.2, 0.9, 0.2]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <SceneLabel position={[0, 0.4, 0]}>лазер</SceneLabel>
      </group>

      {/* adjustable slit: two razor blades on a holder */}
      <group position={[0, 1.0, 0]}>
        {[1, -1].map((s) => (
          <mesh key={s} position={[0, s * (w / 2 + 0.6), 0]}>
            <boxGeometry args={[0.03, 1.2, 0.6]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.95} roughness={0.15} />
          </mesh>
        ))}
        <mesh position={[0, -1.0 + 0.0, -0.38]}>
          <boxGeometry args={[0.2, 2.4, 0.1]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <SceneLabel position={[0, 1.45, 0]}>{`щель из двух лезвий: Δx = ${w.toFixed(2).replace(".", ",")}`}</SceneLabel>
      </group>

      <instancedMesh ref={instRef} args={[undefined, undefined, N_SLIT_PARTICLES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#f87171" toneMapped={false} />
      </instancedMesh>

      {/* screen with the light spot: its height is the spread of momenta */}
      <group position={[3.0, 1.0, 0]}>
        <mesh>
          <boxGeometry args={[0.04, 3.0, 1.6]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.9} />
        </mesh>
        <mesh position={[-0.03, 0, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[0.5, spotH, 1]}>
          <circleGeometry args={[0.5, 32]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.75} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 1.75, 0]}>экран: пятно</SceneLabel>
      </group>
    </>
  );
}

export function UncertaintyPrincipleSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, sMin, sMax, slitW } = useControls("Принцип неопределённости", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Волновой пакет Δx/Δp": "abstract", "Лазер и сужающаяся щель": "slit" },
    },
    sMin: { value: 0.3, min: 0.1, max: 0.6, step: 0.05, label: "Δx мин, усл.ед.", render: (get) => get("Принцип неопределённости.scenario") === "abstract" },
    sMax: { value: 1.6, min: 1, max: 3, step: 0.1, label: "Δx макс, усл.ед.", render: (get) => get("Принцип неопределённости.scenario") === "abstract" },
    slitW: { value: 0.8, min: 0.15, max: 1.4, step: 0.05, label: "ширина щели Δx, усл.ед.", render: (get) => get("Принцип неопределённости.scenario") === "slit" },
  });
  const isSlit = scenario === "slit";
  const slitAngleStd = VIS_HBAR / (2 * slitW * P0);

  const curve = useMemo(() => {
    const pts: { sx: number; sp: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const sx = sMin * 0.8 + (sMax * 1.2 - sMin * 0.8) * (i / 40);
      pts.push({ sx: Number(sx.toFixed(2)), sp: Number(((HBAR / (2 * sx)) * 1e34).toFixed(3)) });
    }
    return pts;
  }, [sMin, sMax]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, sx: sMin, sp: HBAR / (2 * sMin), product: HBAR / 2 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, sxN: 0, spN: 1 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, sx: sMin, sp: HBAR / (2 * sMin), product: HBAR / 2 });
    setSeries([{ t: 0, sxN: 0, spN: 1 }]);
  }, [sMin]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const narrow = live.sx < (sMin + sMax) / 2;
  const caption = isSlit ? (
    <>
      Щель «измеряет», где прошёл свет, с точностью Δx. Чем уже щель, тем точнее координата — но тем сильнее лучи <b>разбегаются в стороны</b>: разброс поперечного импульса Δp ≥ ℏ/(2Δx). Сузьте
      щель — пятно на экране станет выше, а не меньше!
    </>
  ) : narrow ? (
    <>
      Пакет короткий — мы почти точно знаем, <b>где</b> частица, но он сложен из множества волн с разными длинами: импульс размыт (красное табло широкое). Как короткий удар по барабану: в нём много
      частот сразу.
    </>
  ) : (
    <>
      Пакет длинный — в нём почти одна длина волны, поэтому <b>импульс</b> известен точно (красное табло узкое), зато где частица — неясно. Как долгий звук камертона: частота точная, а «где» звук —
      размазано во времени. Произведение Δx·Δp не бывает меньше ℏ/2.
    </>
  );
  const legend: LegendItem[] = isSlit
    ? [{ color: "#f87171", label: "фотоны лазера", kind: "dot" }]
    : [
        { color: "#4ade80", label: "вероятность координаты", kind: "square" },
        { color: "#f87171", label: "вероятность импульса", kind: "square" },
        { color: "#fde68a", label: "волновой пакет", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isSlit ? { position: [0.8, 2.4, 6.2] as [number, number, number], fov: 50 } : { position: [0, 2.2, 6.0] as [number, number, number], fov: 50 }}
          orbitTarget={isSlit ? [0, 1.0, 0] : [0, 1.2, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.75}
          fogRange={[14, 40]}
        >
          {isSlit ? (
            <SceneSlit key={clock.resetNonce} w={slitW} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} sMin={sMin} sMax={sMax} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isSlit ? (
          <NumberReadouts
            items={[
              { label: "Ширина щели Δx", value: slitW.toFixed(2), unit: "усл.ед.", color: "#4ade80" },
              { label: "Δp_⊥ = ℏ/(2Δx)", value: (VIS_HBAR / (2 * slitW)).toFixed(3), color: "#f87171" },
              { label: "Угловой разброс θ ≈ Δp/p₀", value: ((slitAngleStd * 180) / Math.PI).toFixed(1), unit: "°" },
              { label: "Чем уже щель", value: "тем шире расходится пучок" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Δx(t) — разброс координаты", value: live.sx.toFixed(3), unit: "усл.ед.", color: "#4ade80" },
              { label: "Δp(t) = ℏ/(2Δx)", value: live.sp.toExponential(3), unit: "кг·м/с", color: "#f87171" },
              { label: "Δx·Δp", value: live.product.toExponential(4), unit: "Дж·с" },
              { label: "ℏ/2 (минимум)", value: (HBAR / 2).toExponential(4), unit: "Дж·с" },
            ]}
          />
        )
      }
      graphs={
        isSlit ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Пропуская пучок частиц через щель, мы тем самым «измеряем» их поперечную координату с точностью
            Δx (ширина щели). По принципу неопределённости это сразу задаёт минимальный разброс поперечного
            импульса Δp≥ℏ/(2Δx) — частицы приобретают случайные боковые отклонения и пучок за щелью
            расходится веером. Сузьте щель ползунком — пучок расплывётся сильнее; расширьте — пучок останется
            почти параллельным.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Δp(Δx) = ℏ/(2Δx)</p>
              <LiveChart data={curve} xKey="sx" xType="number" xLabel="Δx, усл.ед." series={[{ key: "sp", color: "#f87171", label: "Δp, ×10⁻³⁴ кг·м/с" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Нормированные Δx(t) и Δp(t) — противофаза</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "sxN", color: "#4ade80", label: "Δx/Δx_max" }, { key: "spN", color: "#f87171", label: "Δp (отн.)" }]} />
            </div>
          </div>
        )
      }
      note={
        isSlit ? (
          <>
            Это тот же принцип Δx·Δp≥ℏ/2, только в форме реального демонстрационного опыта: сужение щели —
            это уменьшение неопределённости координаты, а расширение пучка за щелью — прямое наблюдаемое
            следствие роста неопределённости импульса. Именно так принцип неопределённости демонстрировался
            на пучках электронов и атомов.
          </>
        ) : (
          <>
            Зелёные столбики — распределение вероятности координаты |ψ(x)|² (ширина Δx), красные — распределение
            импульса |φ(p)|² (ширина Δp). Чем уже волновой пакет в координате, тем шире он в импульсе — это не
            погрешность измерения, а фундаментальное свойство волн: короткий цуг всегда содержит много длин
            волн (как короткий звук — много частот). Для гауссова пакета Δx·Δp точно равно ℏ/2.
          </>
        )
      }
    />
  );
}
