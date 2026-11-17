import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { Stars, Trail } from "@react-three/drei";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { ChargedBall } from "@/components/sim/props/electric";
import { Ground } from "@/components/sim/props/environment";
import { Planet, Sun } from "@/components/sim/props/space";
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const V_SCALE = 0.18;

interface SamplePoint {
  t: number;
  KE: number;
  z: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  KE: number;
  x: number;
  y: number;
  z: number;
}

function stateAt(t: number, omega: number, vPerp0: number, vPar: number, m: number) {
  const vx0 = vPerp0;
  const vy0 = 0;
  const vx = vx0 * Math.cos(omega * t) + vy0 * Math.sin(omega * t);
  const vy = -vx0 * Math.sin(omega * t) + vy0 * Math.cos(omega * t);
  const x = omega !== 0 ? (vx0 / omega) * Math.sin(omega * t) - (vy0 / omega) * (Math.cos(omega * t) - 1) : vx0 * t;
  const y = omega !== 0 ? (vx0 / omega) * (Math.cos(omega * t) - 1) + (vy0 / omega) * Math.sin(omega * t) : 0;
  const z = vPar * t;
  const KE = 0.5 * m * (vx * vx + vy * vy + vPar * vPar);
  return { x, y, z, vx, vy, KE };
}

interface SceneContentProps {
  omega: number;
  vPerp0: number;
  vPar: number;
  m: number;
  sign: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/* ---------- a charged pellet between Helmholtz coils (uniform B along z) ---------- */
const COIL_Z = [-1.2, 3.8];
const COIL_R = 2.6;

function HelmholtzCoils() {
  return (
    <>
      {COIL_Z.map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh castShadow>
            <torusGeometry args={[COIL_R, 0.16, 16, 64]} />
            <meshStandardMaterial color="#b87333" metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0, -COIL_R - 0.45, 0]}>
            <boxGeometry args={[0.3, 0.6, 0.3]} />
            <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, -COIL_R - 0.82, (COIL_Z[0] + COIL_Z[1]) / 2]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.14, COIL_Z[1] - COIL_Z[0] + 0.8]} />
        <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.5} />
      </mesh>
      <SceneLabel position={[COIL_R * 0.75, -COIL_R * 0.75, COIL_Z[1]]}>катушки Гельмгольца</SceneLabel>
    </>
  );
}

function SceneContent({ omega, vPerp0, vPar, m, sign, running, speed, onSample, onLive }: SceneContentProps) {
  const bodyRef = useRef<THREE.Group>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const fArrow = useRef<VectorArrowHandle>(null);
  // draw the orbit around the coil axis: shift by the centre of the circle
  const shiftY = omega !== 0 ? vPerp0 / omega : 0;

  const handleFrame = useCallback(
    (t: number) => {
      const { x, y, z, vx, vy } = stateAt(t, omega, vPerp0, vPar, m);
      const p: [number, number, number] = [x, y + shiftY, z * 0.3];
      if (bodyRef.current) bodyRef.current.position.set(...p);
      vArrow.current?.set(p, [vx * V_SCALE, vy * V_SCALE, vPar * V_SCALE * 0.3]);
      if (omega === 0) fArrow.current?.hide();
      else {
        // the Lorentz force always points to the centre of the circle
        const len = Math.hypot(p[0], p[1]) || 1;
        fArrow.current?.set(p, [(-p[0] / len) * 0.7, (-p[1] / len) * 0.7, 0]);
      }
    },
    [omega, vPerp0, vPar, m, shiftY],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const { x, y, z, KE } = stateAt(t, omega, vPerp0, vPar, m);
          onSample({ t, KE, z });
          onLive({ t, KE, x, y, z });
        }}
      />

      <HelmholtzCoils />
      {[-1.4, 0, 1.4].flatMap((x) =>
        [-1.4, 1.4].map((y) => <FieldArrow key={`${x}${y}`} origin={[x, y, -0.6]} vector={[0, 0, 1.1]} color="#5eead4" opacity={0.6} />),
      )}
      <SceneLabel position={[0, -1.85, 1.3]}>однородное поле B (вдоль оси катушек)</SceneLabel>

      <Trail width={2.5} length={9} color={sign === 0 ? "#a1a1aa" : sign > 0 ? "#fbbf24" : "#7dd3fc"} attenuation={(w) => w} target={bodyRef}>
        <group ref={bodyRef}>
          {sign === 0 ? (
            <mesh castShadow>
              <sphereGeometry args={[0.14, 20, 20]} />
              <meshStandardMaterial color="#a1a1aa" roughness={0.4} />
            </mesh>
          ) : (
            <ChargedBall sign={sign > 0 ? 1 : -1} radius={0.15} />
          )}
          <SceneLabel position={[0, 0.38, 0]}>{sign === 0 ? "нейтральная частица" : "заряженная пылинка"}</SceneLabel>
        </group>
      </Trail>

      <VectorArrow ref={vArrow} color="#4ade80" />
      <VectorArrow ref={fArrow} color="#f87171" />
      <Ground kind="concrete" from={-8} to={8} width={14} tile={3} tileZ={3} y={-COIL_R - 0.89} z={1.3} />
    </>
  );
}

/* ---------- aurora: particles of the solar wind spiral along the Earth's field lines to the poles ---------- */
const EARTH_R = 1;
const L_SHELL = 4.5;
const THETA_END = Math.asin(Math.sqrt((EARTH_R + 0.04) / L_SHELL));
const TRAVEL = 6;
const CYCLE = TRAVEL + 0.9;

/** point on the dipole field line r = L·sin²θ (θ — colatitude) in the plane of azimuth φ; `hemi` = +1 north, −1 south */
function fieldPoint(theta: number, phi: number, hemi: number) {
  const r = L_SHELL * Math.sin(theta) ** 2;
  return new THREE.Vector3(r * Math.sin(theta) * Math.cos(phi), hemi * r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
}

/** helical path of a particle gyrating around the field line; the gyro-radius shrinks as the field grows toward the pole */
function spiralPath(phi: number, hemi: number, rho0: number, turns: number) {
  const pts: THREE.Vector3[] = [];
  const N = 500;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const theta = Math.PI / 2 - s * (Math.PI / 2 - THETA_END);
    const p = fieldPoint(theta, phi, hemi);
    const ahead = fieldPoint(theta - 0.002, phi, hemi);
    const tangent = ahead.clone().sub(p).normalize();
    const side = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi)).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, side).normalize();
    const bRatio = Math.sqrt(1 + 3 * Math.cos(theta) ** 2) / Math.sin(theta) ** 6;
    const rho = rho0 / Math.sqrt(bRatio);
    const a = s * turns * Math.PI * 2;
    pts.push(p.add(side.multiplyScalar(Math.cos(a) * rho)).add(normal.multiplyScalar(Math.sin(a) * rho)));
  }
  return new THREE.CatmullRomCurve3(pts);
}

function FieldLines() {
  const geos = useMemo(() => {
    const out: THREE.TubeGeometry[] = [];
    for (const L of [1.8, 2.8, L_SHELL]) {
      for (let k = 0; k < 6; k++) {
        const phi = (k / 6) * Math.PI * 2;
        const pts: THREE.Vector3[] = [];
        const th0 = Math.asin(Math.sqrt(EARTH_R / L));
        for (let i = 0; i <= 80; i++) {
          const theta = th0 + (i / 80) * (Math.PI - 2 * th0);
          const r = L * Math.sin(theta) ** 2;
          pts.push(new THREE.Vector3(r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi)));
        }
        out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.008, 4, false));
      }
    }
    return out;
  }, []);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color="#5eead4" transparent opacity={0.28} />
        </mesh>
      ))}
    </>
  );
}

function SceneAurora({ omega, vPerp0, vPar, m, sign, rLarmor, running, speed, onSample, onLive }: SceneContentProps & { rLarmor: number }) {
  const particles = useRef<(THREE.Group | null)[]>([]);
  const ovals = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const neutral = useRef<THREE.Group>(null!);
  const charged = sign !== 0;
  const rho0 = THREE.MathUtils.clamp(0.08 + 0.18 * Math.sqrt(rLarmor), 0.08, 0.45);
  const turns = THREE.MathUtils.clamp(6 + Math.abs(omega) / 2, 6, 22) * Math.sign(omega || 1);
  const paths = useMemo(
    () => [
      { curve: spiralPath(Math.PI, 1, rho0, turns), hemi: 1, delay: 0 },
      { curve: spiralPath(Math.PI + 0.5, -1, rho0, turns), hemi: -1, delay: CYCLE / 2 },
    ],
    [rho0, turns],
  );
  const tubes = useMemo(() => paths.map((p) => new THREE.TubeGeometry(p.curve, 600, 0.012, 4, false)), [paths]);
  useEffect(() => () => tubes.forEach((g) => g.dispose()), [tubes]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const handleFrame = useCallback(
    (t: number) => {
      paths.forEach((p, i) => {
        const g = particles.current[i];
        const u = ((t + p.delay) % CYCLE) / TRAVEL;
        if (g) {
          g.visible = charged && u <= 1;
          if (u <= 1) g.position.copy(p.curve.getPointAt(Math.min(u, 1), tmp));
        }
        // the oval flares up when a particle hits the upper atmosphere
        const mat = ovals.current[i];
        if (mat) mat.emissiveIntensity = charged ? 0.6 + (u > 1 ? 3.5 * Math.exp(-(u - 1) * TRAVEL * 3) : 0) : 0.15;
      });
      if (neutral.current) {
        neutral.current.visible = !charged;
        const u = (t % 5) / 5;
        neutral.current.position.set(-7 + 14 * u, 2.9, 0.6);
      }
    },
    [paths, charged, tmp],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const { x, y, z, KE } = stateAt(t, omega, vPerp0, vPar, m);
          onSample({ t, KE, z });
          onLive({ t, KE, x, y, z });
        }}
      />
      <Stars radius={60} depth={30} count={1500} factor={3} fade speed={0.3} />
      <Planet kind="earth" radius={EARTH_R} spin={0.03} />
      <FieldLines />
      <Sun position={[-34, 5, -14]} radius={2.2} />
      <SceneLabel position={[-34, 8.2, -14]}>Солнце: отсюда летит солнечный ветер</SceneLabel>

      {/* aurora ovals around both magnetic poles */}
      {[1, -1].map((hemi, i) => (
        <mesh key={hemi} position={[0, hemi * (EARTH_R + 0.04) * Math.cos(THETA_END), 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[(EARTH_R + 0.04) * Math.sin(THETA_END), 0.05, 8, 64]} />
          <meshStandardMaterial
            ref={(mat) => void (ovals.current[i] = mat)}
            color="#4ade80"
            emissive="#22c55e"
            emissiveIntensity={0.6}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        </mesh>
      ))}
      <SceneLabel position={[0, EARTH_R + 0.75, 0]}>полярное сияние</SceneLabel>

      {charged &&
        tubes.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshBasicMaterial color={sign > 0 ? "#fbbf24" : "#7dd3fc"} transparent opacity={0.55} />
          </mesh>
        ))}
      {paths.map((_, i) => (
        <group key={i} ref={(g) => void (particles.current[i] = g)}>
          <mesh>
            <sphereGeometry args={[0.07, 14, 10]} />
            <meshStandardMaterial color={sign > 0 ? "#fbbf24" : "#7dd3fc"} emissive={sign > 0 ? "#fbbf24" : "#7dd3fc"} emissiveIntensity={2} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {charged && <SceneLabel position={[-L_SHELL - 0.3, 0.55, 0]}>частица крутится вокруг силовой линии</SceneLabel>}
      <group ref={neutral} visible={false}>
        <mesh>
          <sphereGeometry args={[0.08, 14, 10]} />
          <meshStandardMaterial color="#d4d4d8" />
        </mesh>
        {!charged && <SceneLabel position={[0, 0.35, 0]}>нейтральная частица летит прямо</SceneLabel>}
      </group>
    </>
  );
}

/* ---------- mass spectrometer ---------- */
interface MassSpecLive {
  t: number;
  landedA: boolean;
  landedB: boolean;
  dz: number;
}

/** radius of the D-shaped vacuum chamber, scene units */
const CHAMBER_R = 3;
const ION_Y = 0.5;

function SceneMassSpec({ v, B, q, mA, mB, running, speed, onLive }: { v: number; B: number; q: number; mA: number; mB: number; running: boolean; speed: number; onLive: (n: MassSpecLive) => void }) {
  const ballARef = useRef<THREE.Group>(null!);
  const ballBRef = useRef<THREE.Group>(null!);
  const spotA = useRef<THREE.Mesh>(null!);
  const spotB = useRef<THREE.Mesh>(null!);
  const rA = (mA * v) / (q * B);
  const rB = (mB * v) / (q * B);
  const omegaA = (q * B) / mA;
  const omegaB = (q * B) / mB;
  // 0.6 scene units per metre, reduced if the heavier ion would not fit into the chamber
  const SCALE = Math.min(0.6, (CHAMBER_R * 0.95) / rB);
  const sTex = useMemo(() => badgeTexture("S", "#2563eb"), []);
  const nTex = useMemo(() => badgeTexture("N", "#dc2626"), []);

  const posAt = useCallback(
    (r: number, omega: number, t: number) => {
      const theta = Math.min(omega * t, Math.PI);
      return { x: r * Math.sin(theta) * SCALE, z: r * (1 - Math.cos(theta)) * SCALE, done: omega * t >= Math.PI };
    },
    [SCALE],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const a = posAt(rA, omegaA, t);
      const b = posAt(rB, omegaB, t);
      if (ballARef.current) ballARef.current.position.set(a.x, ION_Y, a.z);
      if (ballBRef.current) ballBRef.current.position.set(b.x, ION_Y, b.z);
      if (spotA.current) spotA.current.visible = a.done;
      if (spotB.current) spotB.current.visible = b.done;
    },
    [rA, rB, omegaA, omegaB, posAt],
  );

  const plateEnd = 2 * CHAMBER_R + 0.2;
  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const a = posAt(rA, omegaA, t);
          const b = posAt(rB, omegaB, t);
          onLive({ t, landedA: a.done, landedB: b.done, dz: Math.abs(rB - rA) * 2 });
        }}
      />

      {/* D-shaped vacuum chamber between the poles of a big magnet: N below, S above (B points up) */}
      <mesh position={[0, ION_Y, CHAMBER_R]}>
        <cylinderGeometry args={[CHAMBER_R, CHAMBER_R, 0.6, 64, 1, true, 0, Math.PI]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.05, CHAMBER_R]} receiveShadow>
        <cylinderGeometry args={[CHAMBER_R + 0.2, CHAMBER_R + 0.2, 0.5, 64, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#b91c1c" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.15, CHAMBER_R]}>
        <cylinderGeometry args={[CHAMBER_R + 0.2, CHAMBER_R + 0.2, 0.3, 64, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#1d4ed8" metalness={0.4} roughness={0.5} transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <sprite position={[CHAMBER_R + 0.6, -0.05, CHAMBER_R]} scale={0.4}>
        <spriteMaterial map={nTex} depthTest={false} transparent />
      </sprite>
      <sprite position={[CHAMBER_R + 0.6, 1.2, CHAMBER_R]} scale={0.4}>
        <spriteMaterial map={sTex} depthTest={false} transparent />
      </sprite>
      {[0.8, 2.0].flatMap((x) => [1.4, 3.0, 4.6].map((z) => <FieldArrow key={`${x}${z}`} origin={[x, 0.22, z]} vector={[0, 0.6, 0]} color="#5eead4" opacity={0.55} />))}
      <SceneLabel position={[CHAMBER_R + 0.6, 1.75, CHAMBER_R]}>магнит: поле B вверх</SceneLabel>

      {/* ion source with an accelerating slit */}
      <mesh position={[-0.75, ION_Y, 0]} castShadow>
        <boxGeometry args={[0.7, 0.5, 0.5]} />
        <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.4} />
      </mesh>
      {[-0.25, -0.1].map((x) => (
        <mesh key={x} position={[x, ION_Y, 0]}>
          <boxGeometry args={[0.04, 0.5, 0.5]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <SceneLabel position={[-0.75, ION_Y + 0.6, 0]}>источник ионов</SceneLabel>

      <Trail width={1.6} length={14} color="#5eead4" attenuation={(w) => w} target={ballARef}>
        <group ref={ballARef} position={[0, ION_Y, 0]}>
          <ChargedBall sign={1} radius={0.1} color="#14b8a6" />
          <SceneLabel position={[0, 0.3, 0]}>лёгкий ион</SceneLabel>
        </group>
      </Trail>
      <Trail width={1.6} length={14} color="#fbbf24" attenuation={(w) => w} target={ballBRef}>
        <group ref={ballBRef} position={[0, ION_Y, 0]}>
          <ChargedBall sign={1} radius={0.1} color="#d97706" />
          <SceneLabel position={[0, -0.3, 0]}>тяжёлый ион</SceneLabel>
        </group>
      </Trail>

      {/* photographic plate along the flat side of the chamber, with the spots the ions leave */}
      <mesh position={[-0.03, ION_Y, (0.25 + plateEnd) / 2]} castShadow>
        <boxGeometry args={[0.05, 0.6, plateEnd - 0.25]} />
        <meshStandardMaterial color="#27272a" roughness={0.6} />
      </mesh>
      <mesh ref={spotA} position={[0.0, ION_Y, 2 * rA * SCALE]} rotation={[0, Math.PI / 2, 0]} visible={false}>
        <circleGeometry args={[0.09, 20]} />
        <meshBasicMaterial color="#5eead4" toneMapped={false} />
      </mesh>
      <mesh ref={spotB} position={[0.0, ION_Y, 2 * rB * SCALE]} rotation={[0, Math.PI / 2, 0]} visible={false}>
        <circleGeometry args={[0.09, 20]} />
        <meshBasicMaterial color="#fbbf24" toneMapped={false} />
      </mesh>
      <SceneLabel position={[-0.5, ION_Y + 0.65, rB * SCALE * 2 + 0.3]}>фотопластинка (детектор)</SceneLabel>

      <Ground kind="tiles" from={-6} to={8} width={12} tile={2} tileZ={2} y={-0.3} z={2.5} />
    </>
  );
}

export function LorentzForceSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, qMicro, mMg, B, vPerp0, vPar, vSpec, Bspec, massRatio } = useControls("Сила Лоренца", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Пылинка в катушках Гельмгольца": "abstract", "Полярное сияние": "aurora", "Масс-спектрометр": "massspec" },
    },
    qMicro: { value: 5, min: -15, max: 15, step: 1, label: "q, мкКл", render: (get) => get("Сила Лоренца.scenario") !== "massspec" },
    mMg: { value: 2, min: 0.5, max: 8, step: 0.5, label: "m, мг", render: (get) => get("Сила Лоренца.scenario") !== "massspec" },
    B: { value: 0.8, min: 0.1, max: 2, step: 0.05, label: "B, Тл", render: (get) => get("Сила Лоренца.scenario") !== "massspec" },
    vPerp0: { value: 3, min: 0.5, max: 6, step: 0.25, label: "v⊥ (поперечная), м/с", render: (get) => get("Сила Лоренца.scenario") !== "massspec" },
    vPar: { value: 0.6, min: 0, max: 3, step: 0.1, label: "v∥ (вдоль B), м/с", render: (get) => get("Сила Лоренца.scenario") === "abstract" },
    vSpec: { value: 2, min: 0.5, max: 5, step: 0.25, label: "v ионов, м/с", render: (get) => get("Сила Лоренца.scenario") === "massspec" },
    Bspec: { value: 1, min: 0.3, max: 2, step: 0.1, label: "B, Тл", render: (get) => get("Сила Лоренца.scenario") === "massspec" },
    massRatio: { value: 1.1, min: 1.02, max: 1.3, step: 0.02, label: "m(тяж.)/m(лёгк.)", render: (get) => get("Сила Лоренца.scenario") === "massspec" },
  });
  const aurora = scenario === "aurora";
  const massspec = scenario === "massspec";

  const q = qMicro * 1e-6;
  const m = mMg * 1e-6;
  const omega = (q * B) / m;
  const r = q === 0 ? null : m * vPerp0 / (Math.abs(q) * B);
  const T = q === 0 ? null : (2 * Math.PI * m) / (Math.abs(q) * B);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, KE: 0.5 * m * (vPerp0 * vPerp0 + vPar * vPar), x: 0, y: 0, z: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, KE: 0.5 * m * (vPerp0 * vPerp0 + vPar * vPar), z: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    const KE0 = 0.5 * m * (vPerp0 * vPerp0 + vPar * vPar);
    setLive({ t: 0, KE: KE0, x: 0, y: 0, z: 0 });
    setSeries([{ t: 0, KE: KE0, z: 0 }]);
  }, [m, vPerp0, vPar]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const qSpec = 1e-6;
  const mA = 1e-6;
  const mB = mA * massRatio;
  const [specLive, setSpecLive] = useState<MassSpecLive>({ t: 0, landedA: false, landedB: false, dz: 0 });
  const dzMax = (2 * vSpec * mA * (massRatio - 1)) / (qSpec * Bspec);

  // restart the flight whenever a parameter changes, so the trail always matches the settings
  const paramKey = `${scenario}|${qMicro}|${mMg}|${B}|${vPerp0}|${vPar}|${vSpec}|${Bspec}|${massRatio}`;
  const lastKey = useRef(paramKey);
  useEffect(() => {
    if (lastKey.current === paramKey) return;
    lastKey.current = paramKey;
    handleReset();
    setSpecLive({ t: 0, landedA: false, landedB: false, dz: 0 });
  }, [paramKey, handleReset]);

  const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
  const sign = Math.sign(qMicro);
  const caption = massspec ? (
    <>
      Ионы двух изотопов вылетают с одинаковой скоростью и зарядом. Магнит заворачивает их по полуокружностям радиуса <b>r = mv/(qB)</b>: тяжёлый ион поворачивает шире и попадает на фотопластинку
      дальше. Расстояние между пятнами {fmt(dzMax, 3)} м — по нему и узнают массу.
    </>
  ) : aurora ? (
    sign === 0 ? (
      <>Нейтральная частица (q = 0) магнитного поля Земли не чувствует и пролетает мимо по прямой. Сделайте заряд ненулевым.</>
    ) : (
      <>
        Частицы солнечного ветра попадают в магнитное поле Земли. Сила Лоренца закручивает их <b>в спираль вокруг силовых линий</b>, и они скользят вдоль линий к полюсам. Там они врезаются в
        атмосферу и заставляют светиться кислород — зелёное <b>полярное сияние</b>.
      </>
    )
  ) : sign === 0 ? (
    <>Заряда нет (q = 0) — магнитное поле на частицу не действует, она летит по прямой.</>
  ) : (
    <>
      Сила Лоренца (красная стрелка) всегда перпендикулярна скорости (зелёная) и смотрит в центр — частица идёт по <b>окружности радиуса r = {fmt(r ?? 0)} м</b>, не меняя скорости. Скорость вдоль
      поля v∥ растягивает окружность в спираль.{" "}
      {sign > 0 ? "Положительный заряд" : "Отрицательный заряд"} крутится {sign > 0 ? "по часовой стрелке" : "против часовой стрелки"}, если смотреть вдоль поля.
    </>
  );
  const legend: LegendItem[] = massspec
    ? [
        { color: "#5eead4", label: "лёгкий ион / поле B" },
        { color: "#fbbf24", label: "тяжёлый ион", kind: "line" },
      ]
    : aurora
      ? [
          { color: "#5eead4", label: "силовые линии поля Земли", kind: "line" },
          { color: "#fbbf24", label: "путь частицы", kind: "line" },
          { color: "#4ade80", label: "полярное сияние", kind: "square" },
        ]
      : [
          { color: "#4ade80", label: "скорость v" },
          { color: "#f87171", label: "сила Лоренца F" },
          { color: "#5eead4", label: "магнитное поле B" },
        ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={massspec ? { position: [5.2, 7.2, 3.0] as [number, number, number], fov: 50 } : aurora ? { position: [3.5, 2.2, 9.5] as [number, number, number], fov: 50 } : { position: [7.5, 3.2, 10] as [number, number, number], fov: 50 }}
          orbitTarget={massspec ? [0.8, 0.4, 2.6] : aurora ? [-1, 0, 0] : [0, 0, 1.3]}
          simplified={isMobile}
          maxDistance={24}
          minDistance={3}
          bloomThreshold={aurora ? 0.5 : 0.65}
          fogRange={aurora ? [40, 90] : [16, 45]}
        >
          {massspec ? (
            <SceneMassSpec key={clock.resetNonce} v={vSpec} B={Bspec} q={qSpec} mA={mA} mB={mB} running={clock.running} speed={clock.speed} onLive={setSpecLive} />
          ) : aurora ? (
            <SceneAurora
              key={clock.resetNonce}
              omega={omega}
              vPerp0={vPerp0}
              vPar={vPar}
              m={m}
              sign={sign}
              rLarmor={r ?? 0}
              running={clock.running}
              speed={clock.speed}
              onSample={handleSample}
              onLive={setLive}
            />
          ) : (
            <SceneContent key={clock.resetNonce} omega={omega} vPerp0={vPerp0} vPar={vPar} m={m} sign={sign} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        massspec ? (
          <NumberReadouts
            items={[
              { label: "r лёгкого = m·v/(qB)", value: ((mA * vSpec) / (qSpec * Bspec)).toFixed(3), unit: "м" },
              { label: "r тяжёлого", value: ((mB * vSpec) / (qSpec * Bspec)).toFixed(3), unit: "м" },
              { label: "Δz на детекторе = 2Δr", value: dzMax.toFixed(3), unit: "м", color: "#f87171" },
              { label: "Состояние", value: specLive.landedA && specLive.landedB ? "оба попали на пластинку" : "в полёте" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "r = mv⊥/(|q|B)", value: r?.toFixed(3) ?? "∞", unit: "м" },
              { label: "T = 2πm/(|q|B)", value: T?.toFixed(3) ?? "нет вращения", unit: T === null ? undefined : "с" },
              { label: "ω циклотронная", value: Math.abs(omega).toFixed(2), unit: "рад/с" },
              { label: "Кинетич. энергия (сохр.)", value: (live.KE * 1e6).toFixed(2), unit: "мкДж" },
              { label: "z (дрейф вдоль B)", value: live.z.toFixed(2), unit: "м" },
            ]}
          />
        )
      }
      graphs={
        massspec ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Ионы влетают с одинаковой скоростью v и зарядом q, но разной массой m. В однородном магнитном
            поле радиус их полукруглой траектории r=mv/(qB) зависит только от массы — поэтому более тяжёлый
            изотоп попадает на фотопластинку дальше от входа. По измеренному расстоянию между следами
            восстанавливают точное соотношение масс изотопов.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Кинетическая энергия сохраняется (сила Лоренца работы не совершает)</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "KE", color: "#4ade80", label: "KE, Дж" }]} />
          </div>
        )
      }
      note={
        massspec ? (
          <>
            Масс-спектрометр разделяет ионы по массе, используя силу Лоренца: F=qv×B заставляет частицы
            двигаться по окружности радиуса r=mv/(qB). При одинаковых q и v радиус пропорционален массе —
            это позволяет измерять массы изотопов с высокой точностью.
          </>
        ) : aurora ? (
          <>
            Заряженные частицы солнечного ветра, попадая в магнитное поле Земли, движутся по спирали вдоль
            силовых линий (сила Лоренца перпендикулярна скорости — работы не совершает, энергия сохраняется).
            Поле сгущается у полюсов, радиус спирали уменьшается, и частицы «стекают» туда, сталкиваясь с
            атмосферой — так рождается полярное сияние. Размеры на рисунке условные.
          </>
        ) : (
          <>
            Сила Лоренца F=qv×B всегда перпендикулярна скорости, поэтому работы не совершает — кинетическая
            энергия точно сохраняется (график KE(t) — прямая линия). Поперечная составляющая скорости даёт
            круговое вращение радиуса r=mv⊥/(|q|B), а составляющая вдоль поля v∥ добавляет равномерный дрейф —
            получается винтовая (спиральная) траектория. Катушки Гельмгольца — пара одинаковых колец с
            током — создают между собой почти однородное магнитное поле.
          </>
        )
      }
    />
  );
}
