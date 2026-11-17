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
import { Ground } from "@/components/sim/props/environment";
import { DialGauge } from "@/components/sim/props/thermo";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/* ---------- shared toy model: neutrons fly in a plane over a 9×9 lattice of nuclei ---------- */
const GRID = 9;
const SPACING = 0.55;
const CAPTURE_R = 0.14;
const NEUTRON_SPEED = 1.1;
const MAX_NEUTRONS = 400;
const BOUND = (GRID * SPACING) / 2 + 0.5;
/** s — window over which k and the power are averaged */
const TAU = 1.5;
/** chance that a neutron in a fresh lattice hits a nucleus before escaping (measured with this model) */
const P_HIT = 0.85;
/** average number of neutrons from one fission of U-235 */
const NU_U235 = 2.4;

/* ---------- reactor ---------- */
/** boron plates hang between the rows of fuel rods */
const ROD_XS = [-1.375, -0.825, -0.275, 0.275, 0.825, 1.375];
const ROD_HALF = 0.04;
const CORE_Y0 = -0.45;
const CORE_Y1 = 0.85;
const PLATE_H = 1.6;
/** s — after a fission that spot of the fuel rod is busy for a moment (the rod holds ~10²² more nuclei) */
const REGEN = 0.5;
/** s — interval of the start-up neutron source */
const SOURCE_DT = 0.7;
const SOURCE_X = 0;
const SOURCE_Z = SPACING / 2;
const CORE_Y: [number, number] = [CORE_Y0, CORE_Y1];
/** k versus plate depth 0…1 in steps of 0.1 — computed offline with exactly this model (generation method). */
const K_TABLE = [2.07, 1.85, 1.71, 1.56, 1.36, 1.23, 1.07, 0.9, 0.77, 0.6, 0.32];
function kOfDepth(depth: number) {
  const x = THREE.MathUtils.clamp(depth, 0, 1) * 10;
  const i = Math.min(Math.floor(x), 9);
  return K_TABLE[i] + (K_TABLE[i + 1] - K_TABLE[i]) * (x - i);
}
/** A plate lowered to depth d covers the upper fraction d of the core height. */
const plateBottomOf = (depth: number) => CORE_Y1 - depth * (CORE_Y1 - CORE_Y0);

/* ---------- mousetraps ---------- */
const BALL_R = 0.045;
const BALL_SPOTS: [number, number][][] = [
  [],
  [[-0.04, 0]],
  [
    [-0.04, -0.055],
    [-0.04, 0.055],
  ],
  [
    [-0.09, -0.055],
    [-0.09, 0.055],
    [0.01, 0],
  ],
  [
    [-0.09, -0.055],
    [-0.09, 0.055],
    [0.01, -0.055],
    [0.01, 0.055],
  ],
];
/** A ping-pong ball bounces along in low hops. */
const hopY = (age: number) => BALL_R + 0.005 + Math.abs(Math.sin(age * 9)) * 0.2;
/** s — the trap's steel hammer swings over the hinge */
const SNAP_T = 0.08;

interface Nucleus {
  x: number;
  z: number;
  /** time of its fission; −∞ while intact */
  spentAt: number;
  /** height at which the neutron struck (for the flash) */
  hitY: number;
}
interface Neutron {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
}
interface SimState {
  t: number;
  nuclei: Nucleus[];
  neutrons: Neutron[];
  /** exponentially weighted counts over the last ~TAU seconds */
  bornW: number;
  deadW: number;
  fissW: number;
  fissions: number;
  sourceT: number;
}
interface SimConfig {
  nu: number;
  /** how long a struck site stays used up; Infinity — for good (a sprung mousetrap) */
  regen: number;
  yRange: [number, number];
  /** lower edge of the boron plates; undefined — no plates */
  plateBottom?: number;
  source?: boolean;
}

interface SamplePoint {
  t: number;
  neutrons: number;
  fissioned: number;
  power: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  neutrons: number;
  fissioned: number;
  total: number;
  fissions: number;
  k: number;
  power: number;
}
interface SceneProps {
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function makeNuclei(): Nucleus[] {
  const arr: Nucleus[] = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      arr.push({ x: (i - (GRID - 1) / 2) * SPACING, z: (j - (GRID - 1) / 2) * SPACING, spentAt: -Infinity, hitY: 0 });
    }
  }
  return arr;
}

function emptyState(): SimState {
  return { t: 0, nuclei: makeNuclei(), neutrons: [], bornW: 0, deadW: 0, fissW: 0, fissions: 0, sourceT: 0 };
}

function spawn(s: SimState, x: number, z: number, yRange: [number, number]) {
  if (s.neutrons.length >= MAX_NEUTRONS) return;
  const a = Math.random() * Math.PI * 2;
  s.neutrons.push({ x, z, y: yRange[0] + Math.random() * (yRange[1] - yRange[0]), vx: Math.cos(a) * NEUTRON_SPEED, vz: Math.sin(a) * NEUTRON_SPEED, age: 0 });
}

function simStep(s: SimState, dt: number, cfg: SimConfig) {
  s.t += dt;
  const decay = Math.exp(-dt / TAU);
  s.bornW *= decay;
  s.deadW *= decay;
  s.fissW *= decay;
  if (cfg.source) {
    s.sourceT += dt;
    if (s.sourceT >= SOURCE_DT) {
      s.sourceT -= SOURCE_DT;
      spawn(s, SOURCE_X, SOURCE_Z, cfg.yRange);
    }
  }
  const births: number[] = [];
  const survivors: Neutron[] = [];
  for (const n of s.neutrons) {
    n.x += n.vx * dt;
    n.z += n.vz * dt;
    n.age += dt;
    // flew out of the lattice
    if (Math.abs(n.x) > BOUND || Math.abs(n.z) > BOUND) {
      s.deadW++;
      continue;
    }
    // swallowed by boron — only where the plate has been lowered
    if (cfg.plateBottom !== undefined && n.y > cfg.plateBottom && ROD_XS.some((rx) => Math.abs(n.x - rx) < ROD_HALF)) {
      s.deadW++;
      continue;
    }
    // only the nearest lattice site can be close enough to capture
    const gi = Math.round(n.x / SPACING + (GRID - 1) / 2);
    const gj = Math.round(n.z / SPACING + (GRID - 1) / 2);
    const nu = gi >= 0 && gi < GRID && gj >= 0 && gj < GRID ? s.nuclei[gi * GRID + gj] : undefined;
    if (nu && s.t - nu.spentAt >= cfg.regen) {
      const dx = n.x - nu.x;
      const dz = n.z - nu.z;
      if (dx * dx + dz * dz < CAPTURE_R * CAPTURE_R) {
        nu.spentAt = s.t;
        nu.hitY = n.y;
        const count = Math.floor(cfg.nu) + (Math.random() < cfg.nu - Math.floor(cfg.nu) ? 1 : 0);
        s.deadW++;
        s.fissW++;
        s.fissions++;
        // counted even when the picture has no room for more neutrons, so k stays honest
        s.bornW += count;
        for (let k = 0; k < count; k++) births.push(nu.x, nu.z);
        continue;
      }
    }
    survivors.push(n);
  }
  s.neutrons = survivors;
  for (let i = 0; i < births.length; i += 2) spawn(s, births[i], births[i + 1], cfg.yRange);
}

function readout(s: SimState, kFallback: number): LiveNumbers {
  let spent = 0;
  for (const nu of s.nuclei) if (nu.spentAt > -Infinity) spent++;
  return {
    t: s.t,
    neutrons: s.neutrons.length,
    fissioned: spent,
    total: s.nuclei.length,
    fissions: s.fissions,
    k: s.deadW > 3 ? s.bornW / s.deadW : kFallback,
    power: s.fissW / TAU,
  };
}

function makeTrapState(): SimState {
  const s = emptyState();
  // the first ball is tossed onto the central trap
  s.neutrons.push({ x: -0.3, y: 0, z: 0, vx: NEUTRON_SPEED, vz: 0, age: 0 });
  return s;
}

function makeReactorState(): SimState {
  const s = emptyState();
  for (let i = 0; i < 6; i++) spawn(s, SOURCE_X, SOURCE_Z, CORE_Y);
  return s;
}

/* ================= 1. Mousetraps with ping-pong balls ================= */
function SceneTraps({ nu, running, speed, onSample, onLive }: SceneProps & { nu: number }) {
  const [sim] = useState<SimState>(makeTrapState);
  const cfg = useMemo<SimConfig>(() => ({ nu, regen: Infinity, yRange: [0, 0] }), [nu]);
  const spots = BALL_SPOTS[nu] ?? BALL_SPOTS[2];
  const baseRef = useRef<THREE.InstancedMesh>(null!);
  const pedalRef = useRef<THREE.InstancedMesh>(null!);
  const barRef = useRef<THREE.InstancedMesh>(null!);
  const restRef = useRef<THREE.InstancedMesh>(null!);
  const ballRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const handleFixedStep = useCallback((dt: number) => simStep(sim, dt, cfg), [sim, cfg]);

  const handleFrame = useCallback(() => {
    const base = baseRef.current;
    const pedal = pedalRef.current;
    const bars = barRef.current;
    const rest = restRef.current;
    const balls = ballRef.current;
    if (!base || !pedal || !bars || !rest || !balls) return;
    const hide = () => {
      dummy.position.set(0, -999, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
    };
    sim.nuclei.forEach((tr, i) => {
      dummy.scale.set(1, 1, 1);
      dummy.position.set(tr.x, 0.015, tr.z);
      dummy.updateMatrix();
      base.setMatrixAt(i, dummy.matrix);
      dummy.position.set(tr.x + 0.03, 0.033, tr.z);
      dummy.updateMatrix();
      pedal.setMatrixAt(i, dummy.matrix);
      // the hammer swings from the cocked side (+x) over the hinge to the other side
      const loaded = tr.spentAt === -Infinity;
      const a = loaded ? 0 : Math.min((sim.t - tr.spentAt) / SNAP_T, 1) * Math.PI;
      dummy.position.set(tr.x + 0.12 * Math.cos(a), 0.04 + 0.12 * Math.sin(a), tr.z);
      dummy.updateMatrix();
      bars.setMatrixAt(i, dummy.matrix);
      // balls still waiting on a loaded trap
      for (let b = 0; b < 4; b++) {
        const spot = spots[b];
        if (loaded && spot) {
          dummy.position.set(tr.x + spot[0], 0.03 + BALL_R, tr.z + spot[1]);
          dummy.scale.setScalar(BALL_R);
          dummy.updateMatrix();
        } else hide();
        rest.setMatrixAt(i * 4 + b, dummy.matrix);
      }
    });
    base.instanceMatrix.needsUpdate = true;
    pedal.instanceMatrix.needsUpdate = true;
    bars.instanceMatrix.needsUpdate = true;
    rest.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_NEUTRONS; i++) {
      const n = sim.neutrons[i];
      if (n) {
        dummy.position.set(n.x, hopY(n.age), n.z);
        dummy.scale.setScalar(BALL_R);
        dummy.updateMatrix();
      } else hide();
      balls.setMatrixAt(i, dummy.matrix);
    }
    balls.instanceMatrix.needsUpdate = true;
  }, [dummy, sim, spots]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={10}
        onSample={() => {
          const r = readout(sim, P_HIT * nu);
          onSample({ t: r.t, neutrons: r.neutrons, fissioned: r.fissioned, power: r.power });
          onLive(r);
        }}
      />
      <Ground kind="parquet" from={-5} to={5} width={8} tile={2} tileZ={2} y={-0.001} />

      <instancedMesh ref={baseRef} args={[undefined, undefined, GRID * GRID]} frustumCulled={false} castShadow receiveShadow>
        <boxGeometry args={[0.38, 0.03, 0.24]} />
        <meshStandardMaterial color="#d6a463" roughness={0.75} />
      </instancedMesh>
      <instancedMesh ref={pedalRef} args={[undefined, undefined, GRID * GRID]} frustumCulled={false}>
        <boxGeometry args={[0.07, 0.006, 0.09]} />
        <meshStandardMaterial color="#b45309" metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={barRef} args={[undefined, undefined, GRID * GRID]} frustumCulled={false} castShadow>
        <boxGeometry args={[0.018, 0.018, 0.22]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.25} />
      </instancedMesh>
      <instancedMesh ref={restRef} args={[undefined, undefined, GRID * GRID * 4]} frustumCulled={false} castShadow>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={ballRef} args={[undefined, undefined, MAX_NEUTRONS]} frustumCulled={false} castShadow>
        <sphereGeometry args={[1, 12, 10]} />
        <meshStandardMaterial color="#fff7ed" emissive="#fb923c" emissiveIntensity={0.45} roughness={0.35} />
      </instancedMesh>
      <SceneLabel position={[0, 1.1, -(GRID * SPACING) / 2 - 0.5]}>мышеловка = ядро урана · шарик = нейтрон</SceneLabel>
    </>
  );
}

/* ================= 2. Pool-type research reactor ================= */
function SceneReactor({ rodDepth, running, speed, onSample, onLive }: SceneProps & { rodDepth: number }) {
  const [sim] = useState<SimState>(makeReactorState);
  // mutable: the drive moves the plates smoothly, the physics reads where they really are
  const cfg = useMemo<SimConfig>(() => ({ nu: NU_U235, regen: REGEN, yRange: CORE_Y, plateBottom: plateBottomOf(0.65), source: true }), []);
  const plates = useRef<THREE.Group>(null!);
  const fuelRef = useRef<THREE.InstancedMesh>(null!);
  const flashRef = useRef<THREE.InstancedMesh>(null!);
  const neutronRef = useRef<THREE.InstancedMesh>(null!);
  const waterMat = useRef<THREE.MeshStandardMaterial>(null!);
  const powerRef = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const handleFixedStep = useCallback((dt: number) => simStep(sim, dt, cfg), [sim, cfg]);

  const handleFrame = useCallback(
    (_t: number, dt: number) => {
      const target = plateBottomOf(rodDepth);
      const now = cfg.plateBottom ?? target;
      cfg.plateBottom = now + (target - now) * Math.min(1, dt * 2.5);
      if (plates.current) plates.current.position.y = cfg.plateBottom + PLATE_H / 2;

      const power = sim.fissW / TAU;
      powerRef.current = Math.min(power / 200, 1.05);
      // the blue Cherenkov glow of the water follows the power
      if (waterMat.current) waterMat.current.emissiveIntensity = 0.12 + Math.min(power / 150, 1) * 1.3;

      const fuel = fuelRef.current;
      const flash = flashRef.current;
      if (fuel && flash) {
        sim.nuclei.forEach((nu, i) => {
          dummy.scale.set(1, 1, 1);
          dummy.position.set(nu.x, (CORE_Y0 + CORE_Y1) / 2, nu.z);
          dummy.updateMatrix();
          fuel.setMatrixAt(i, dummy.matrix);
          const age = sim.t - nu.spentAt;
          if (age < REGEN) {
            dummy.position.set(nu.x, nu.hitY, nu.z);
            dummy.scale.setScalar(0.04 + 0.11 * (1 - age / REGEN));
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          flash.setMatrixAt(i, dummy.matrix);
        });
        fuel.instanceMatrix.needsUpdate = true;
        flash.instanceMatrix.needsUpdate = true;
      }

      const mesh = neutronRef.current;
      if (mesh) {
        for (let i = 0; i < MAX_NEUTRONS; i++) {
          const n = sim.neutrons[i];
          if (n) {
            dummy.position.set(n.x, n.y, n.z);
            dummy.scale.setScalar(0.045);
          } else {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    [cfg, dummy, rodDepth, sim],
  );

  const half = (GRID * SPACING) / 2 + 0.6;
  const wallH = 1.75;
  const wallY = -0.6 + wallH / 2;
  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        onFixedStep={handleFixedStep}
        sampleHz={10}
        onSample={() => {
          const r = readout(sim, kOfDepth(rodDepth));
          onSample({ t: r.t, neutrons: r.neutrons, fissioned: r.fissioned, power: r.power });
          onLive(r);
        }}
      />
      <Ground kind="concrete" from={-9} to={9} width={14} tile={4} y={-0.66} />

      {/* the pool: steel-lined tank of water */}
      <mesh position={[0, -0.63, 0]} receiveShadow>
        <boxGeometry args={[half * 2 + 0.4, 0.06, half * 2 + 0.4]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.6} />
      </mesh>
      {[
        [0, -half - 0.1, half * 2 + 0.4, 0.2],
        [0, half + 0.1, half * 2 + 0.4, 0.2],
        [-half - 0.1, 0, 0.2, half * 2],
        [half + 0.1, 0, 0.2, half * 2],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, wallY, z]} castShadow receiveShadow>
          <boxGeometry args={[w, wallH, d]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.55} metalness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[half * 2, 1.65, half * 2]} />
        <meshStandardMaterial ref={waterMat} color="#1d4ed8" emissive="#38bdf8" emissiveIntensity={0.12} transparent opacity={0.25} depthWrite={false} />
      </mesh>

      {/* fuel rods with uranium-235 */}
      <instancedMesh ref={fuelRef} args={[undefined, undefined, GRID * GRID]} frustumCulled={false} castShadow>
        <cylinderGeometry args={[0.035, 0.035, CORE_Y1 - CORE_Y0, 10]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.75} roughness={0.3} />
      </instancedMesh>
      {/* a fission: the nucleus splits, the fragments heat the rod */}
      <instancedMesh ref={flashRef} args={[undefined, undefined, GRID * GRID]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshBasicMaterial color="#fb923c" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={neutronRef} args={[undefined, undefined, MAX_NEUTRONS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#fde047" emissive="#fde047" emissiveIntensity={1.2} />
      </instancedMesh>
      {/* start-up neutron source */}
      <mesh position={[SOURCE_X, (CORE_Y0 + CORE_Y1) / 2, SOURCE_Z]}>
        <cylinderGeometry args={[0.05, 0.05, CORE_Y1 - CORE_Y0, 12]} />
        <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.6} roughness={0.4} />
      </mesh>

      {/* boron plates on a common drive */}
      <group ref={plates} position={[0, plateBottomOf(0.65) + PLATE_H / 2, 0]}>
        {ROD_XS.map((rx) => (
          <mesh key={rx} position={[rx, 0, 0]} castShadow>
            <boxGeometry args={[ROD_HALF * 2, PLATE_H, GRID * SPACING + 0.3]} />
            <meshStandardMaterial color="#3f3f46" metalness={0.5} roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[0, PLATE_H / 2 + 0.05, 0]} castShadow>
          <boxGeometry args={[3.2, 0.1, 0.35]} />
          <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh position={[0, PLATE_H / 2 + 1.1, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 2, 10]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.85} roughness={0.25} />
        </mesh>
      </group>

      {/* power meter on the control desk */}
      <mesh position={[3.9, 0.1, 2.3]} castShadow>
        <cylinderGeometry args={[0.04, 0.05, 1.5, 8]} />
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.4} />
      </mesh>
      <DialGauge label="P" valueRef={powerRef} radius={0.32} position={[3.9, 1.05, 2.3]} rotation={[0, -0.5, 0]} />
      <SceneLabel position={[3.9, 1.55, 2.3]}>мощность</SceneLabel>
      <SceneLabel position={[0, 3.1, -1.2]}>пластины из бора на приводе</SceneLabel>
      <SceneLabel position={[-0.9, 1.3, 3.0]}>голубое свечение воды — эффект Черенкова</SceneLabel>
    </>
  );
}

const TRAP_WORDS = ["", "новый шарик", "новых шарика", "новых шарика", "новых шарика"];

export function NuclearReactionsFissionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, neutronsPerFission, rodDepthPct } = useControls("Цепная реакция деления", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Мышеловки с шариками (модель цепной реакции)": "abstract", "Реактор с управляющими стержнями": "reactor" },
    },
    neutronsPerFission: { value: 2, min: 1, max: 4, step: 1, label: "Шариков в мышеловке (нейтронов на деление)", render: (get) => get("Цепная реакция деления.scenario") === "abstract" },
    rodDepthPct: { value: 65, min: 0, max: 100, step: 1, label: "Глубина стержней, %", render: (get) => get("Цепная реакция деления.scenario") === "reactor" },
  });
  const isReactor = scenario === "reactor";
  const rodDepth = rodDepthPct / 100;
  const nu = THREE.MathUtils.clamp(Math.round(neutronsPerFission), 1, 4);

  const blank = useMemo<LiveNumbers>(() => ({ t: 0, neutrons: 1, fissioned: 0, total: GRID * GRID, fissions: 0, k: 0, power: 0 }), []);
  const [live, setLive] = useState<LiveNumbers>(blank);
  const [series, setSeries] = useState<SamplePoint[]>([]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 300 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    setLive(blank);
    setSeries([]);
  }, [clock, blank]);

  // another example or another number of balls starts the run again
  const paramKey = isReactor ? "reactor" : `traps-${nu}`;
  const lastKey = useRef(paramKey);
  useEffect(() => {
    if (lastKey.current === paramKey) return;
    lastKey.current = paramKey;
    handleReset();
  }, [paramKey, handleReset]);

  const kRod = kOfDepth(rodDepth);
  const saturated = live.neutrons >= MAX_NEUTRONS * 0.95;
  const kTraps = live.t > 0 ? live.k : P_HIT * nu;
  const ended = !isReactor && live.t > 0.5 && live.neutrons === 0;
  const trapsLeft = live.total - live.fissioned;

  const reactorMode = saturated ? "разгон — мощность зашкаливает" : kRod > 1.03 ? "надкритический: мощность растёт" : kRod >= 0.97 ? "критический: мощность постоянна" : "подкритический: реакция гаснет";
  const trapMode = ended ? "реакция закончилась" : kTraps > 1.03 ? "надкритический (лавина)" : kTraps >= 0.97 ? "критический" : "подкритический (затухает)";

  const caption = isReactor ? (
    <>
      Бассейновый исследовательский реактор. В воде стоят <b>твэлы</b> — стержни с ураном-235; оранжевые вспышки — деления ядер. Между ними висят <b>пластины из бора</b>: нейтрон, налетевший на
      опущенную часть пластины, поглощается.{" "}
      {saturated ? (
        <>Мощность зашкаливает! В настоящем реакторе здесь сработала бы аварийная защита — все пластины падают вниз. Опустите их сами.</>
      ) : kRod > 1.03 ? (
        <>
          Пластины подняты слишком высоко ({rodDepthPct} %): нейтронов рождается больше, чем теряется (k = {kRod.toFixed(2)}), мощность растёт с каждой секундой.
        </>
      ) : kRod >= 0.97 ? (
        <>Равновесие: каждое деление в среднем вызывает ровно одно новое (k ≈ 1). Мощность держится ровной — вода нагревается, пар крутит турбину.</>
      ) : (
        <>
          Пластины опущены глубоко ({rodDepthPct} %): бор съедает нейтроны, k = {kRod.toFixed(2)} &lt; 1 — реакция гаснет, остаются лишь редкие нейтроны от пускового источника.
        </>
      )}
    </>
  ) : (
    <>
      Известный опыт: каждая взведённая мышеловка — <b>ядро урана-235</b>, шарик для пинг-понга — <b>нейтрон</b>. Шарик попадает в мышеловку, она срабатывает и подбрасывает {nu} {TRAP_WORDS[nu]}.{" "}
      {ended ? (
        <>
          Шариков в полёте не осталось — реакция закончилась. Сработало {live.fissioned} из {live.total} мышеловок.
        </>
      ) : kTraps > 1.03 ? (
        <>
          Шариков всё больше — это <b>цепная лавина</b> (k = {kTraps.toFixed(2)}): каждое «деление» вызывает больше одного нового. Так за миллионные доли секунды делится уран в атомной бомбе.
        </>
      ) : nu === 1 ? (
        <>Одного шарика мало: часть шариков улетает мимо, k = {kTraps.toFixed(2)} &lt; 1 — реакция быстро гаснет.</>
      ) : trapsLeft < live.total * 0.6 ? (
        <>Взведённых мышеловок почти не осталось ({trapsLeft}) — лавина гаснет: «топливо» кончилось.</>
      ) : (
        <>Многие шарики улетают за край — реакция пока еле тлеет.</>
      )}
    </>
  );
  const legend: LegendItem[] = isReactor
    ? [
        { color: "#94a3b8", label: "твэл (уран-235)", kind: "line" },
        { color: "#fb923c", label: "деление ядра", kind: "dot" },
        { color: "#fde047", label: "нейтрон", kind: "dot" },
        { color: "#71717a", label: "пластина из бора", kind: "square" },
        { color: "#ef4444", label: "пусковой источник нейтронов", kind: "line" },
      ]
    : [
        { color: "#d6a463", label: "мышеловка = ядро U-235", kind: "square" },
        { color: "#f8fafc", label: "шарик на мышеловке = нейтрон в ядре", kind: "dot" },
        { color: "#fb923c", label: "летящий шарик = свободный нейтрон", kind: "dot" },
      ];

  const camera = isReactor ? { position: [1.2, 6.6, 8.6] as [number, number, number], fov: 50 } : { position: [0, 4.6, 4.3] as [number, number, number], fov: 50 };

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={camera} orbitTarget={isReactor ? [0.4, 0, 1.0] : [0, 0, 0.45]} simplified={isMobile} maxDistance={20} minDistance={3} bloomThreshold={0.75} fogRange={[16, 45]}>
          {isReactor ? (
            <SceneReactor key={clock.resetNonce} rodDepth={rodDepth} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          ) : (
            <SceneTraps key={clock.resetNonce} nu={nu} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        isReactor ? (
          <NumberReadouts
            items={[
              { label: "Глубина стержней", value: rodDepthPct.toString(), unit: "%" },
              { label: "Коэффициент размножения k", value: kRod.toFixed(2) },
              { label: "Свободных нейтронов", value: saturated ? `${MAX_NEUTRONS}+` : live.neutrons.toString() },
              { label: "Мощность", value: live.power.toFixed(0), unit: "делений/с" },
              { label: "Режим", value: reactorMode },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Шариков в полёте (нейтронов)", value: live.neutrons.toString() },
              { label: "Сработало мышеловок (делений)", value: `${live.fissioned} / ${live.total}` },
              { label: "Коэффициент размножения k", value: kTraps.toFixed(2) },
              { label: "Режим", value: trapMode },
            ]}
          />
        )
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">{isReactor ? "Нейтроны и мощность реактора во времени" : "Шарики в полёте и сработавшие мышеловки"}</p>
          <LiveChart
            data={series}
            xKey="t"
            xLabel="t, с"
            series={
              isReactor
                ? [
                    { key: "neutrons", color: "#fde047", label: "нейтроны" },
                    { key: "power", color: "#38bdf8", label: "мощность, делений/с" },
                  ]
                : [
                    { key: "neutrons", color: "#fb923c", label: "шарики в полёте" },
                    { key: "fissioned", color: "#d6a463", label: "сработавшие мышеловки" },
                  ]
            }
          />
        </div>
      }
      note={
        isReactor ? (
          <>
            Коэффициент размножения k — сколько новых делений в среднем вызывает одно деление. Им управляют пластинами или стержнями из бора и кадмия: эти ядра жадно поглощают нейтроны. Показанное
            значение k рассчитано для этой модели заранее (методом поколений). В настоящем реакторе вода ещё и замедляет нейтроны, а около 0,65 % нейтронов вылетает с запаздыванием в секунды — именно
            они делают реакцию управляемой: мощность меняется за минуты, а не за доли секунды. Время в модели сильно растянуто: в реакторе поколение нейтронов сменяется за десятки микросекунд, в
            бомбе — примерно за 10 наносекунд. Голубое свечение воды — излучение Черенкова: быстрые электроны летят в воде быстрее, чем свет в воде.
          </>
        ) : (
          <>
            Опыт с мышеловками показывают на лекциях с 1950-х годов: стол со взведёнными мышеловками за секунды превращается в облако летающих шариков. Деление настоящего ядра U-235 даёт в среднем
            2,4 нейтрона. Если в среднем хотя бы один из них вызывает новое деление (k ≥ 1), реакция поддерживается, если больше одного (k &gt; 1) — растёт лавиной. Часть нейтронов вылетает за край
            куска урана, поэтому у маленького куска k &lt; 1, и только начиная с критической массы (около 50 кг для чистого U-235) идёт цепная реакция.
          </>
        )
      }
    />
  );
}
