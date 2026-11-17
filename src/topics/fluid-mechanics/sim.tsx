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
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { WoodenCrate } from "@/components/sim/props/mechanics";
import { Ground } from "@/components/sim/props/environment";
import { rockyTexture } from "@/components/sim/props/textures";

const X_MIN = -5;
const X_MAX = 5;
const W = 2.5;
const Y0 = 0.6;
const NP = 40;
const SEG_COUNT = 32;
const HIGH_P_COLOR = new THREE.Color("#38bdf8");
const LOW_P_COLOR = new THREE.Color("#fb923c");

function radiusAt(x: number, R1: number, R2: number) {
  const t = Math.min(Math.abs(x) / W, 1);
  const smooth = t * t * (3 - 2 * t);
  return R2 + (R1 - R2) * smooth;
}

interface Particle {
  x: number;
  phase: number;
  radial: number;
}

interface SamplePoint {
  t: number;
  v: number;
  p: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  v2: number;
  p2: number;
}

interface SceneContentProps {
  v1: number;
  R1: number;
  R2: number;
  rho: number;
  P1: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ v1, R1, R2, rho, P1, running, speed, onSample, onLive }: SceneContentProps) {
  const instRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particlesRef = useRef<Particle[]>(
    Array.from({ length: NP }, () => ({
      x: X_MIN + Math.random() * (X_MAX - X_MIN),
      phase: Math.random() * Math.PI * 2,
      radial: 0.15 + Math.random() * 0.7,
    })),
  );

  const pressureAt = useCallback(
    (x: number) => {
      const r = radiusAt(x, R1, R2);
      const v = (v1 * (R1 * R1)) / (r * r);
      const p = P1 + 0.5 * rho * (v1 * v1 - v * v);
      return { v, p };
    },
    [v1, R1, R2, rho, P1],
  );

  const handleFixedStep = useCallback(
    (dt: number) => {
      const arr = particlesRef.current;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const r = radiusAt(p.x, R1, R2);
        const v = (v1 * (R1 * R1)) / (r * r);
        p.x += v * dt;
        if (p.x > X_MAX) p.x -= X_MAX - X_MIN;
      }
    },
    [v1, R1, R2],
  );

  const handleFrame = useCallback(() => {
    const arr = particlesRef.current;
    const mesh = instRef.current;
    if (!mesh) return;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const r = radiusAt(p.x, R1, R2);
      const y = Y0 + p.radial * r * Math.cos(p.phase);
      const z = p.radial * r * Math.sin(p.phase);
      dummy.position.set(p.x, y, z);
      dummy.scale.setScalar(0.055);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [R1, R2, dummy]);

  const gauges = useMemo(() => {
    const pW = pressureAt(-4).p;
    const pT = pressureAt(0).p;
    const span = Math.max(pW - pT, 1);
    // relative scale: the wide-section column is ~1.6 m, the throat column drops by the Bernoulli difference
    const h = (pp: number) => 0.2 + (1.4 * (pp - pT + span * 0.15)) / (span * 1.15);
    return [
      { x: -4, p: pW / 1000, h: h(pW), label: "до сужения" },
      { x: 0, p: pT / 1000, h: h(pT), label: "горловина" },
      { x: 4, p: pressureAt(4).p / 1000, h: h(pressureAt(4).p), label: "после" },
    ];
  }, [pressureAt]);

  const segments = useMemo(() => {
    const segs: { xm: number; r0: number; r1: number; len: number; color: string }[] = [];
    const { p: pThroat } = pressureAt(0);
    for (let i = 0; i < SEG_COUNT; i++) {
      const x0 = X_MIN + ((X_MAX - X_MIN) * i) / SEG_COUNT;
      const x1 = X_MIN + ((X_MAX - X_MIN) * (i + 1)) / SEG_COUNT;
      const xm = (x0 + x1) / 2;
      const r0 = radiusAt(x0, R1, R2);
      const r1 = radiusAt(x1, R1, R2);
      const { p } = pressureAt(xm);
      const denom = P1 - pThroat;
      const t = Math.abs(denom) > 1e-6 ? Math.max(0, Math.min(1, (p - pThroat) / denom)) : 1;
      const col = LOW_P_COLOR.clone().lerp(HIGH_P_COLOR, t);
      segs.push({ xm, r0, r1, len: x1 - x0, color: `#${col.getHexString()}` });
    }
    return segs;
  }, [R1, R2, P1, pressureAt]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={20}
        onSample={(t) => {
          const { v, p } = pressureAt(0);
          onSample({ t, v, p: p / 1000 });
          onLive({ t, v2: v, p2: p / 1000 });
        }}
      />

      {segments.map((seg, i) => (
        <mesh key={i} position={[seg.xm, Y0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[seg.r0, seg.r1, seg.len, 24, 1, true]} />
          <meshStandardMaterial color={seg.color} transparent opacity={0.32} side={THREE.DoubleSide} roughness={0.2} metalness={0.2} />
        </mesh>
      ))}

      <instancedMesh ref={instRef} args={[undefined, undefined, NP]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshStandardMaterial color="#7dd3fc" emissive="#38bdf8" emissiveIntensity={0.5} roughness={0.2} />
      </instancedMesh>

      <Ground kind="tiles" from={-8} to={8} width={6} tile={2} tileZ={2} y={Y0 - 1.6} />
      {[-4.2, 4.2].map((x) => (
        <mesh key={x} position={[x, Y0 - 1.6 + (1.6 - R1) / 2, 0]} castShadow>
          <boxGeometry args={[0.12, 1.6 - R1, 0.6]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {[X_MIN, X_MAX].map((x) => (
        <mesh key={x} position={[x, Y0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[R1 + 0.08, R1 + 0.08, 0.12, 28]} />
          <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      {/* piezometer tubes: the water column height shows the static pressure under each tube */}
      {gauges.map((g) => (
        <group key={g.x} position={[g.x, 0, 0]}>
          <mesh position={[0, Y0 + radiusAt(g.x, R1, R2) + 1.0, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 2.0, 16, 1, true]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[0, Y0 + radiusAt(g.x, R1, R2) + g.h / 2, 0]}>
            <cylinderGeometry args={[0.06, 0.06, g.h, 16]} />
            <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.3} transparent opacity={0.85} />
          </mesh>
          <SceneLabel position={[0, Y0 + radiusAt(g.x, R1, R2) + g.h + 0.3, 0]}>{`${g.label}: ${g.p.toFixed(1)} кПа`}</SceneLabel>
        </group>
      ))}
      <SceneLabel position={[0, Y0 - R2 - 0.35, 0.6]}>горловина: вода быстрее</SceneLabel>
    </>
  );
}

const ARCH_S = 0.8;
const ARCH_G = 9.8;
const ARCH_BOTTOM = -2.2;

interface ObjectMaterial {
  label: string;
  rho: number;
}
const OBJECT_MATERIALS: Record<string, ObjectMaterial> = {
  ice: { label: "Лёд", rho: 917 },
  wood: { label: "Дерево", rho: 600 },
  ship: { label: "Корабль (стальной корпус)", rho: 500 },
  stone: { label: "Камень", rho: 2700 },
};
const LIQUIDS: Record<string, { label: string; rho: number }> = {
  water: { label: "Пресная вода", rho: 1000 },
  saltwater: { label: "Солёная вода (Мёртвое море)", rho: 1240 },
};

interface ArchLive {
  t: number;
  y: number;
  submergedFrac: number;
  floats: boolean;
}

function SceneArchimedes({
  material,
  liquidKey,
  running,
  speed,
  onLive,
}: {
  material: string;
  liquidKey: string;
  running: boolean;
  speed: number;
  onLive: (n: ArchLive) => void;
}) {
  const rhoObj = OBJECT_MATERIALS[material].rho;
  const rhoLiq = LIQUIDS[liquidKey].rho;
  const floats = rhoObj < rhoLiq;
  const frac = Math.min(1, rhoObj / rhoLiq);
  const yEq = ARCH_S * (0.5 - frac);
  const omega0 = Math.sqrt((rhoLiq * ARCH_G) / (rhoObj * ARCH_S));
  const beta = 1.2;

  const objRef = useRef<THREE.Group>(null!);
  const gArrow = useRef<VectorArrowHandle>(null);
  const aArrow = useRef<VectorArrowHandle>(null);
  const stone = useMemo(() => rockyTexture(61, [128, 120, 110]), []);
  const yStart = 2.2;
  const tTouch = Math.sqrt((2 * (yStart - ARCH_S / 2)) / ARCH_G);

  const yAt = useCallback(
    (t: number) => {
      if (t < tTouch) return yStart - 0.5 * ARCH_G * t * t;
      const tt = t - tTouch;
      if (floats) {
        return yEq + (ARCH_S / 2 - yEq) * Math.exp(-beta * tt) * Math.cos(omega0 * tt);
      }
      const ySink = ARCH_S / 2 - 0.6 * tt;
      return Math.max(ySink, ARCH_BOTTOM + ARCH_S / 2);
    },
    [tTouch, floats, yEq, omega0],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const y = yAt(t);
      if (objRef.current) objRef.current.position.y = y;
      // weight vs buoyancy, both scaled to the weight (= 1.1 m)
      const sub = Math.min(1, Math.max(0, (ARCH_S / 2 - y) / ARCH_S));
      gArrow.current?.set([0.22, y, ARCH_S / 2 + 0.2], [0, -1.1, 0]);
      const fa = (rhoLiq * sub) / rhoObj;
      if (fa > 0.01) aArrow.current?.set([-0.22, y - ARCH_S / 2, ARCH_S / 2 + 0.2], [0, 1.1 * fa, 0]);
      else aArrow.current?.hide();
    },
    [yAt, rhoLiq, rhoObj],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const y = yAt(t);
          const submerged = Math.min(1, Math.max(0, (ARCH_S / 2 - y) / ARCH_S));
          onLive({ t, y, submergedFrac: submerged, floats });
        }}
      />

      <Ground kind="tiles" from={-6} to={6} width={8} tile={2} tileZ={2} y={ARCH_BOTTOM - 0.82} />
      {/* aquarium on a cabinet: sand, water, glass walls and a metal frame */}
      <mesh position={[0, ARCH_BOTTOM - 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.7, 0.74, 3.7]} />
        <meshStandardMaterial color="#1f2937" roughness={0.7} />
      </mesh>
      <mesh position={[0, ARCH_BOTTOM + 0.04, 0]}>
        <boxGeometry args={[3.36, 0.08, 3.36]} />
        <meshStandardMaterial color="#d6c08f" roughness={1} />
      </mesh>
      <mesh position={[0, -1.1, 0]}>
        <boxGeometry args={[3.36, 2.2, 3.36]} />
        <meshStandardMaterial color={liquidKey === "saltwater" ? "#0e7490" : "#38bdf8"} transparent opacity={0.3} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.36, 3.36]} />
        <meshStandardMaterial color="#bae6fd" transparent opacity={0.25} roughness={0.05} metalness={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {[
        [0, 1.7, 3.4, 0.05],
        [0, -1.7, 3.4, 0.05],
        [1.7, 0, 0.05, 3.4],
        [-1.7, 0, 0.05, 3.4],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, ARCH_BOTTOM + 1.6, z]}>
          <boxGeometry args={[w, 3.2, d]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.1} roughness={0.05} depthWrite={false} />
        </mesh>
      ))}
      {[-1.72, 1.72].flatMap((x) =>
        [-1.72, 1.72].map((z) => (
          <mesh key={`${x}${z}`} position={[x, ARCH_BOTTOM + 1.6, z]}>
            <boxGeometry args={[0.06, 3.2, 0.06]} />
            <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      <SceneLabel position={[1.3, -0.25, 1.8]}>{LIQUIDS[liquidKey].label}</SceneLabel>

      <group ref={objRef}>
        {material === "ice" && (
          <mesh castShadow>
            <boxGeometry args={[ARCH_S, ARCH_S, ARCH_S]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.82} roughness={0.08} metalness={0.05} />
          </mesh>
        )}
        {material === "wood" && <WoodenCrate size={[ARCH_S, ARCH_S, ARCH_S]} tone="medium" frame={false} />}
        {material === "stone" && (
          <mesh castShadow scale={[1, 0.85, 0.95]}>
            <icosahedronGeometry args={[ARCH_S * 0.62, 1]} />
            <meshStandardMaterial map={stone} roughness={0.95} flatShading />
          </mesh>
        )}
        {material === "ship" && (
          <group>
            <mesh position={[0, -0.1, 0]} castShadow>
              <boxGeometry args={[ARCH_S * 1.25, ARCH_S * 0.6, ARCH_S]} />
              <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[0, -0.05, 0]}>
              <boxGeometry args={[ARCH_S * 1.26, 0.05, ARCH_S * 1.01]} />
              <meshStandardMaterial color="#b91c1c" />
            </mesh>
            <mesh position={[ARCH_S * 0.72, -0.1, 0]} rotation={[0, Math.PI / 4, 0]}>
              <boxGeometry args={[ARCH_S * 0.5, ARCH_S * 0.6, ARCH_S * 0.5]} />
              <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[-0.05, ARCH_S * 0.32, 0]} castShadow>
              <boxGeometry args={[ARCH_S * 0.55, ARCH_S * 0.32, ARCH_S * 0.6]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.5} />
            </mesh>
            <mesh position={[-0.12, ARCH_S * 0.62, 0]}>
              <cylinderGeometry args={[0.07, 0.08, 0.28, 12]} />
              <meshStandardMaterial color="#dc2626" roughness={0.5} />
            </mesh>
          </group>
        )}
        <SceneLabel position={[0, ARCH_S / 2 + 0.55, 0]}>{OBJECT_MATERIALS[material].label}</SceneLabel>
      </group>
      <VectorArrow ref={gArrow} color="#facc15" />
      <VectorArrow ref={aArrow} color="#38bdf8" />
    </>
  );
}

export function FluidMechanicsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, v1, R1, R2, rho, P1, material, liquidKey } = useControls("Механика жидкостей", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Труба Вентури": "abstract", "Закон Архимеда (тонет/плавает)": "archimedes" },
    },
    v1: { value: 1, min: 0.2, max: 3, step: 0.1, label: "v₁, м/с (широкая часть)", render: (get) => get("Механика жидкостей.scenario") === "abstract" },
    R1: { value: 1, min: 0.6, max: 1.2, step: 0.05, label: "R₁, м (широкая часть)", render: (get) => get("Механика жидкостей.scenario") === "abstract" },
    R2: { value: 0.5, min: 0.2, max: 1.1, step: 0.05, label: "R₂, м (горловина)", render: (get) => get("Механика жидкостей.scenario") === "abstract" },
    rho: { value: 1000, min: 400, max: 1500, step: 50, label: "ρ, кг/м³", render: (get) => get("Механика жидкостей.scenario") === "abstract" },
    P1: { value: 150, min: 50, max: 300, step: 5, label: "P₁, кПа", render: (get) => get("Механика жидкостей.scenario") === "abstract" },
    material: {
      value: "ice",
      label: "Материал тела",
      options: { "Лёд": "ice", "Дерево": "wood", "Корабль (стальной корпус)": "ship", "Камень": "stone" },
      render: (get) => get("Механика жидкостей.scenario") === "archimedes",
    },
    liquidKey: {
      value: "water",
      label: "Жидкость",
      options: { "Пресная вода": "water", "Солёная вода (Мёртвое море)": "saltwater" },
      render: (get) => get("Механика жидкостей.scenario") === "archimedes",
    },
  });

  const archimedes = scenario === "archimedes";
  const [archLive, setArchLive] = useState<ArchLive>({ t: 0, y: 2.2, submergedFrac: 0, floats: true });

  const A1 = Math.PI * R1 * R1;
  const A2 = Math.PI * R2 * R2;
  const v2 = (v1 * A1) / A2;
  const P1pa = P1 * 1000;
  const P2 = P1pa + 0.5 * rho * (v1 * v1 - v2 * v2);
  const Q1 = v1 * A1;
  const Q2 = v2 * A2;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, v2, p2: P2 / 1000 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, v: v2, p: P2 / 1000 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, v2, p2: P2 / 1000 });
    setSeries([{ t: 0, v: v2, p: P2 / 1000 }]);
  }, [v2, P2]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const rhoObj = OBJECT_MATERIALS[material].rho;
  const rhoLiq = LIQUIDS[liquidKey].rho;

  // restart the experiment whenever an input changes
  const paramKey = `${scenario}|${v1}|${R1}|${R2}|${rho}|${P1}|${material}|${liquidKey}`;
  const firstParams = useRef(paramKey);
  useEffect(() => {
    if (firstParams.current === paramKey) return;
    firstParams.current = paramKey;
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramKey]);

  let caption;
  let legend: LegendItem[];
  if (archimedes) {
    const pct = Math.round(Math.min(1, rhoObj / rhoLiq) * 100);
    const inSalt = liquidKey === "saltwater";
    caption =
      material === "stone" ? (
        <><b>Камень тонет:</b> его плотность {rhoObj} кг/м³ больше, чем у воды ({rhoLiq}). Даже целиком погружённый, он вытесняет воду, которая весит меньше его самого: голубая стрелка короче жёлтой.</>
      ) : material === "ship" ? (
        <><b>Стальной корабль плавает,</b> хотя сталь в 8 раз тяжелее воды: корпус полый, внутри воздух, и средняя плотность корабля всего {rhoObj} кг/м³. Он сидит в воде на {pct}% высоты.</>
      ) : material === "ice" ? (
        <><b>Лёд плавает,</b> погрузившись на {pct}% — плотность льда {rhoObj} кг/м³ чуть меньше, чем у {inSalt ? "солёной" : "пресной"} воды. Поэтому у айсберга над водой только верхушка.</>
      ) : (
        <><b>Дерево плавает,</b> погрузившись на {pct}%: когда выталкивающая сила (голубая) сравнялась с весом (жёлтая), брусок перестал опускаться и успокоился.</>
      );
    legend = [
      { color: "#facc15", label: "вес mg" },
      { color: "#38bdf8", label: "сила Архимеда F_A" },
    ];
  } else {
    caption = (
      <>
        Трубка сужается — вода в горловине разгоняется до {live.v2.toFixed(1).replace(".", ",")} м/с (столько же воды должно пройти за секунду: v₁A₁ = v₂A₂). Где быстрее, там{" "}
        <b>давление ниже</b> — водяной столбик над горловиной опустился (эффект Вентури, закон Бернулли).
      </>
    );
    legend = [
      { color: "#38bdf8", label: "высокое давление", kind: "square" },
      { color: "#fb923c", label: "низкое давление", kind: "square" },
      { color: "#7dd3fc", label: "частицы воды", kind: "dot" },
    ];
  }

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={archimedes ? { position: [0, 2.2, 7.6], fov: 50 } : { position: [0, 2.6, 10.5], fov: 50 }}
          orbitTarget={archimedes ? [0, -0.4, 0] : [0, 1.0, 0]}
          simplified={isMobile}
          maxDistance={24}
          minDistance={3}
          bloomThreshold={0.6}
          fogRange={[16, 45]}
        >
          {archimedes ? (
            <SceneArchimedes key={clock.resetNonce} material={material} liquidKey={liquidKey} running={clock.running} speed={clock.speed} onLive={setArchLive} />
          ) : (
            <SceneContent key={clock.resetNonce} v1={v1} R1={R1} R2={R2} rho={rho} P1={P1pa} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        archimedes ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: archLive.t.toFixed(2), unit: "с" },
              { label: "ρ тела", value: String(rhoObj), unit: "кг/м³" },
              { label: "ρ жидкости", value: String(rhoLiq), unit: "кг/м³" },
              { label: "Доля погружения", value: (archLive.submergedFrac * 100).toFixed(0), unit: "%", color: "#38bdf8" },
              { label: "Итог", value: archLive.floats ? "плавает" : "тонет", color: archLive.floats ? "#4ade80" : "#f87171" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "v₁ (широкая часть)", value: v1.toFixed(2), unit: "м/с", color: "#4ade80" },
              { label: "v₂ (горловина)", value: live.v2.toFixed(2), unit: "м/с", color: "#4ade80" },
              { label: "P₁", value: P1.toFixed(1), unit: "кПа" },
              { label: "P₂ (горловина)", value: live.p2.toFixed(1), unit: "кПа" },
              { label: "Q₁=v₁A₁", value: Q1.toFixed(3), unit: "м³/с" },
              { label: "Q₂=v₂A₂", value: Q2.toFixed(3), unit: "м³/с" },
            ]}
          />
        )
      }
      graphs={
        archimedes ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Сила Архимеда F=ρ_жидкости·g·V_погруж уравновешивает вес тела mg=ρ_тела·g·V_тела в равновесии — доля
            погружения равна ρ_тела/ρ_жидкости. Корабль сделан из стали (ρ≈7850 кг/м³), но плавает: его СРЕДНЯЯ
            плотность (сталь + воздух внутри корпуса) меньше плотности воды — форма, а не материал, определяет
            плавучесть.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Скорость и давление в горловине</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "v", color: "#4ade80", label: "v₂, м/с" }, { key: "p", color: "#38bdf8", label: "P₂, кПа" }]} />
          </div>
        )
      }
      note={
        archimedes ? (
          <>
            Закон Архимеда: F_A=ρ_ж·g·V_погруж. Тело плавает, если его средняя плотность меньше плотности
            жидкости (лёд, дерево, корабль), и тонет, если больше (камень). В солёной воде (плотность выше)
            тела погружаются меньше — поэтому в Мёртвом море так легко лежать на поверхности.
          </>
        ) : (
          <>
            Уравнение неразрывности v₁A₁=v₂A₂ — в узкой части поток ускоряется (тот же принцип работает в
            пульверизаторе и на крыле самолёта). По уравнению Бернулли P₁+½ρv₁²=P₂+½ρv₂², поэтому в горловине
            давление падает (эффект Вентури) — стенка трубы окрашена от синего (высокое давление) к оранжевому
            (низкое давление).
          </>
        )
      }
    />
  );
}
