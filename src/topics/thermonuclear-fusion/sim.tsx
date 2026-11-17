import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import { Line, Stars } from "@react-three/drei";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Person } from "@/components/sim/props/Person";
import { Ground } from "@/components/sim/props/environment";
import { Sun } from "@/components/sim/props/space";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/* ================= physics of D + T ================= */
const K_B = 1.381e-23;
const EV = 1.602e-19;
/** k·e² in keV·fm */
const KE2 = 1440;
/** D and T touch at r = 1.2 fm·(2^⅓ + 3^⅓) */
const R_TOUCH_FM = 3.24;
const BARRIER_KEV = KE2 / R_TOUCH_FM;
/** Gamow constant of the D+T reaction, keV^½ */
const B_G = 34.38;
const Q_MEV = 17.6;
const kTkeV = (tMK: number) => (K_B * tMK * 1e6) / EV / 1000;
/** energy at which most fusions happen (Gamow peak) */
const gamowPeak = (kT: number) => Math.pow((B_G * kT) / 2, 2 / 3);
/** chance to tunnel through the barrier in one collision at energy E */
const tunnelChance = (E: number) => Math.exp(-B_G / Math.sqrt(E));

/* ---------- the "volcano": potential energy around the tritium nucleus ---------- */
const H = 1.6; // rim = Coulomb barrier
const R0 = 0.45; // rim radius = nuclei touch
const RMAX = 3.0;
const RDISC = 4.0;
const CRATER = 0.45;
const RB = 0.09; // nucleon radius
const G_VIS = 15;
const A0 = R0 / RMAX;
const hill = (r: number) => (r >= RMAX ? 0 : r >= R0 ? (H * (R0 / r - A0)) / (1 - A0) : -CRATER);
const hillSlope = (r: number) => (r >= RMAX || r < R0 ? 0 : (-H * R0) / (r * r) / (1 - A0));
const radiusAt = (h: number) => R0 / ((h / H) * (1 - A0) + A0);
const heightOf = (eKeV: number) => (H * eKeV) / BARRIER_KEV;
const FLOOR_Y = -CRATER + RB;
/** nuclei move just in front of the cut face */
const ZF = 0.16;

const CRATER_PTS: [number, number][] = [
  [0.001, -CRATER],
  [0.3, -CRATER],
  [0.38, -CRATER + 0.15],
  [0.43, H * 0.65],
  [R0, H],
];
const SLOPE_PTS: [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const r = R0 + (RMAX - R0) * (i / 48) ** 2;
    pts.push([r, hill(r)]);
  }
  pts.push([RDISC, 0], [RDISC + 0.02, -0.08]);
  return pts;
})();
const toV2 = (pts: [number, number][]) => pts.map(([r, y]) => new THREE.Vector2(r, y));
const CRATER_V2 = toV2(CRATER_PTS);
const SLOPE_V2 = toV2(SLOPE_PTS);
/** the cut face: the barrier drawn as a graph */
const CAP_SHAPE = (() => {
  const prof = [...CRATER_PTS, ...SLOPE_PTS.slice(1, -1)];
  const shape = new THREE.Shape();
  shape.moveTo(-RDISC, -0.65);
  for (let i = prof.length - 1; i >= 1; i--) shape.lineTo(-prof[i][0], prof[i][1]);
  for (let i = 1; i < prof.length; i++) shape.lineTo(prof[i][0], prof[i][1]);
  shape.lineTo(RDISC, -0.65);
  shape.closePath();
  return shape;
})();
const CONTOURS = [100, 200, 300, 400];
/** the barrier curve drawn on the cut face, like a graph */
const PROFILE_LINE = (() => {
  const prof = [...CRATER_PTS, ...SLOPE_PTS.slice(1, -1)];
  return [...prof.slice(1).reverse().map(([r, y]) => new THREE.Vector3(-r, y, 0.012)), ...prof.slice(1).map(([r, y]) => new THREE.Vector3(r, y, 0.012))];
})();
const WELL_COLOR = new THREE.Color("#dc2626");
const HILL_COLOR = new THREE.Color("#7c3aed");
/** the crater wall turns from violet (repulsion) into red (nuclear attraction) */
function paintCrater(g: THREE.BufferGeometry) {
  const pos = g.getAttribute("position");
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(WELL_COLOR).lerp(HILL_COLOR, THREE.MathUtils.smoothstep(pos.getY(i), 0.3, 1.3));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
}

type NucleonKind = "p" | "n";
const D_KINDS: NucleonKind[] = ["p", "n"];
const T_KINDS: NucleonKind[] = ["p", "n", "n"];
const HE_KINDS: NucleonKind[] = ["p", "n", "n", "p"];
const N_KINDS: NucleonKind[] = ["n"];
const CLUSTER: Record<number, [number, number, number][]> = {
  1: [[0, 0, 0]],
  2: [
    [-0.9, 0, 0],
    [0.9, 0, 0],
  ],
  3: [
    [0, 0.95, 0],
    [-0.85, -0.5, 0],
    [0.85, -0.5, 0],
  ],
  4: [
    [-0.85, 0.85, 0],
    [0.85, 0.85, 0],
    [-0.85, -0.85, 0],
    [0.85, -0.85, 0],
  ],
};

function Nucleus({ kinds, opacity = 1 }: { kinds: NucleonKind[]; opacity?: number }) {
  const offs = CLUSTER[kinds.length];
  return (
    <>
      {kinds.map((k, i) => (
        <mesh key={i} position={[offs[i][0] * RB, offs[i][1] * RB, offs[i][2] * RB]} castShadow>
          <sphereGeometry args={[RB, 16, 12]} />
          <meshStandardMaterial
            color={k === "p" ? "#ef4444" : "#cbd5e1"}
            emissive={k === "p" ? "#7f1d1d" : "#334155"}
            emissiveIntensity={0.45}
            roughness={0.4}
            transparent={opacity < 1}
            opacity={opacity}
            depthWrite={opacity >= 1}
          />
        </mesh>
      ))}
    </>
  );
}

type Phase = "roll" | "tunnel" | "flash" | "fly" | "refill";
interface Stage {
  phase: Phase;
  attempt: number;
}
const TUNNEL_T = 1.1;
const FLASH_T = 0.45;
const FLY_T = 2.6;
const REFILL_T = 1.0;

interface BarrierProps {
  e: number;
  eKeV: number;
  tunnelAttempt: number;
  running: boolean;
  speed: number;
  onStage: (s: Stage) => void;
}

function SceneBarrier({ e, eKeV, tunnelAttempt, running, speed, onStage }: BarrierProps) {
  const st = useRef({ phase: "roll" as Phase, pt: 0, attempt: 1, side: -1, x: RDISC, v: -Math.sqrt(2 * G_VIS * Math.max(e, 0.005)), xTurn: RDISC });
  const last = useRef<Stage>({ phase: "roll", attempt: 1 });
  const [flying, setFlying] = useState(false);
  const dRef = useRef<THREE.Group>(null!);
  const ghostRef = useRef<THREE.Group>(null!);
  const waveRef = useRef<THREE.Mesh>(null!);
  const tRef = useRef<THREE.Group>(null!);
  const heRef = useRef<THREE.Group>(null!);
  const nRef = useRef<THREE.Group>(null!);
  const flashRef = useRef<THREE.Mesh>(null!);
  const flashMat = useRef<THREE.MeshBasicMaterial>(null!);

  const handleFrame = useCallback(
    (_t: number, dt: number) => {
      const s = st.current;
      const v0 = Math.sqrt(2 * G_VIS * Math.max(e, 0.005));
      s.pt += dt;
      if (s.phase === "roll") {
        let rem = dt;
        while (rem > 1e-9) {
          const h = Math.min(rem, 1 / 240);
          rem -= h;
          const before = s.v;
          s.v -= G_VIS * hillSlope(s.x) * h;
          s.x += s.v * h;
          // the turning point: not enough energy to climb further
          if (before < 0 && s.v >= 0 && s.attempt >= tunnelAttempt) {
            s.phase = "tunnel";
            s.pt = 0;
            s.xTurn = s.x;
            break;
          }
          if (s.x > RDISC && s.v > 0) {
            s.attempt += 1;
            s.side = -s.side;
            s.x = RDISC;
            s.v = -v0;
          }
        }
      } else if (s.phase === "tunnel" && s.pt >= TUNNEL_T) {
        s.phase = "flash";
        s.pt = 0;
      } else if (s.phase === "flash" && s.pt >= FLASH_T) {
        s.phase = "fly";
        s.pt = 0;
      } else if (s.phase === "fly" && s.pt >= FLY_T) {
        s.phase = "refill";
        s.pt = 0;
      } else if (s.phase === "refill" && s.pt >= REFILL_T) {
        s.phase = "roll";
        s.pt = 0;
        s.attempt = 1;
        s.side = -1;
        s.x = RDISC;
        s.v = -v0;
      }
      if (s.phase !== last.current.phase || s.attempt !== last.current.attempt) {
        last.current = { phase: s.phase, attempt: s.attempt };
        onStage(last.current);
        setFlying(s.phase === "fly");
      }

      const side = s.side;
      if (dRef.current) {
        dRef.current.visible = s.phase === "roll" || s.phase === "refill";
        const x = s.phase === "refill" ? RDISC : s.x;
        dRef.current.position.set(side * x, hill(x) + RB, ZF);
        dRef.current.rotation.z = (-side * x) / (RB * 1.8);
      }
      if (ghostRef.current) {
        ghostRef.current.visible = s.phase === "tunnel";
        if (s.phase === "tunnel") {
          const u = Math.min(s.pt / TUNNEL_T, 1);
          const yTurn = hill(s.xTurn) + RB;
          let x = 0.22;
          let y = yTurn;
          if (u < 0.75) x = s.xTurn + (0.22 - s.xTurn) * (u / 0.75);
          else y = yTurn + (FLOOR_Y - yTurn) * ((u - 0.75) / 0.25);
          ghostRef.current.position.set(side * x, y, ZF);
          if (waveRef.current) waveRef.current.scale.setScalar(1 + 0.25 * Math.sin(s.pt * 22));
        }
      }
      if (tRef.current) {
        tRef.current.visible = !(s.phase === "fly" || (s.phase === "flash" && s.pt > 0.12));
        tRef.current.scale.setScalar(s.phase === "refill" ? Math.max(Math.min(s.pt / REFILL_T, 1), 0.001) : 1);
      }
      if (flashRef.current && flashMat.current) {
        flashRef.current.visible = s.phase === "flash";
        const u = Math.min(s.pt / FLASH_T, 1);
        flashRef.current.scale.setScalar(0.15 + u * 0.95);
        flashMat.current.opacity = 1 - u * 0.7;
      }
      const fly = s.phase === "fly";
      // equal and opposite momenta: the light neutron flies 4× faster than helium
      if (heRef.current) {
        heRef.current.visible = fly;
        heRef.current.position.set(-side * (0.1 + 0.5 * s.pt), FLOOR_Y + 0.9 * s.pt, ZF);
      }
      if (nRef.current) {
        nRef.current.visible = fly;
        nRef.current.position.set(side * (0.1 + 2.0 * s.pt), FLOOR_Y + 0.9 * s.pt, ZF);
      }
    },
    [e, onStage, tunnelAttempt],
  );

  const eRing = radiusAt(e);
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <Stars radius={70} depth={30} count={1500} factor={3} fade speed={0.3} />
      <Sun radius={1.1} position={[6.2, 3.6, -11]} />
      <SceneLabel position={[5.6, 2.0, -11]}>Солнце: 15 млн K в центре</SceneLabel>

      {/* the back half of the volcano: the cut shows the barrier as a graph */}
      <mesh>
        <latheGeometry args={[SLOPE_V2, 72, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#7c3aed" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <latheGeometry args={[CRATER_V2, 48, Math.PI / 2, Math.PI]} onUpdate={paintCrater} />
        <meshStandardMaterial vertexColors roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <shapeGeometry args={[CAP_SHAPE]} />
        <meshStandardMaterial color="#c4b5fd" emissive="#4c1d95" emissiveIntensity={0.25} roughness={0.8} />
      </mesh>
      <Line points={PROFILE_LINE} color="#f5f3ff" lineWidth={2} />
      {/* height marks every 100 keV */}
      {CONTOURS.map((k) => (
        <mesh key={k} position={[0, heightOf(k), 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radiusAt(heightOf(k)), 0.008, 4, 64, Math.PI]} />
          <meshBasicMaterial color="#ede9fe" transparent opacity={0.5} />
        </mesh>
      ))}
      <SceneLabel position={[0, H + 0.38, 0]}>вершина барьера ≈ {BARRIER_KEV.toFixed(0)} кэВ</SceneLabel>

      {/* the energy of the incoming nuclei */}
      <mesh position={[0, e, ZF - 0.03]}>
        <boxGeometry args={[RDISC * 2, 0.02, 0.02]} />
        <meshBasicMaterial color="#fde047" toneMapped={false} />
      </mesh>
      <mesh position={[0, e, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[eRing, 0.016, 6, 72, Math.PI]} />
        <meshBasicMaterial color="#fde047" toneMapped={false} />
      </mesh>
      <SceneLabel position={[2.4, e + 0.3, ZF]}>энергия ядер ≈ {eKeV.toFixed(0)} кэВ</SceneLabel>

      <group ref={tRef} position={[0, FLOOR_Y, ZF]}>
        <Nucleus kinds={T_KINDS} />
      </group>
      <group ref={dRef}>
        <Nucleus kinds={D_KINDS} />
      </group>
      <group ref={ghostRef} visible={false}>
        <Nucleus kinds={D_KINDS} opacity={0.35} />
        <mesh ref={waveRef}>
          <torusGeometry args={[0.22, 0.012, 6, 40]} />
          <meshBasicMaterial color="#67e8f9" toneMapped={false} transparent opacity={0.8} />
        </mesh>
      </group>
      <mesh ref={flashRef} position={[0, FLOOR_Y, ZF]} visible={false}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial ref={flashMat} color="#fef9c3" toneMapped={false} transparent opacity={1} />
      </mesh>
      <group ref={heRef} visible={false}>
        <Nucleus kinds={HE_KINDS} />
        {flying && <SceneLabel position={[0, 0.35, 0]}>гелий-4 · 3,5 МэВ</SceneLabel>}
      </group>
      <group ref={nRef} visible={false}>
        <Nucleus kinds={N_KINDS} />
        {flying && <SceneLabel position={[0, 0.3, 0]}>нейтрон · 14,1 МэВ</SceneLabel>}
      </group>
    </>
  );
}

/* ================= tokamak (proportions of ITER, 1 unit = 2 m) ================= */
const MU0 = 4e-7 * Math.PI;
const N_PLASMA = 1e20; // m⁻³
const T_PLASMA = 1.5e8; // K
const P_PLASMA = 2 * N_PLASMA * K_B * T_PLASMA; // ions + electrons, Pa
const BETA_MAX = 0.04;
const M_D = 3.344e-27;
const ATM = 101325;
const magPressure = (B: number) => (B * B) / (2 * MU0);
const BETA_DATA = Array.from({ length: 21 }, (_, i) => {
  const B = 3 + i * 0.25;
  return { B, beta: (P_PLASMA / magPressure(B)) * 100, limit: BETA_MAX * 100 };
});

const R_MAJ = 3.1;
const KAPPA = 1.7;
const DELTA = 0.33;
const A_PLASMA = 0.85;
const A_WALL = 1.2;
const A_COIL = 1.55;
const Y0 = 2.9;
const Q_SAFETY = 3;
const N_IONS = 80;

/** D-shaped cross-section of the torus (elongation κ, triangularity δ) */
function dPoint(a: number, th: number): [number, number] {
  return [R_MAJ + a * Math.cos(th + DELTA * Math.sin(th)), KAPPA * a * Math.sin(th)];
}
const dProfile = (a: number, n = 72) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const [r, z] = dPoint(a, (i / n) * Math.PI * 2);
    return new THREE.Vector2(r, z);
  });
const WALL_V2 = dProfile(A_WALL);
const PLASMA_V2 = dProfile(A_PLASMA);
const CORE_V2 = dProfile(A_PLASMA * 0.5);
const toWorld = (r: number, z: number, ph: number) => new THREE.Vector3(r * Math.sin(ph), z, r * Math.cos(ph));
/** 18 toroidal-field coils, the ones in the cut-away quarter are left out */
const COILS = Array.from({ length: 18 }, (_, i) => (i / 18) * Math.PI * 2)
  .filter((ph) => Math.cos(ph) < Math.cos(Math.PI / 4 + 0.12))
  .map(
    (ph) =>
      new THREE.CatmullRomCurve3(
        Array.from({ length: 48 }, (_, k) => {
          const [r, z] = dPoint(A_COIL, (k / 48) * Math.PI * 2);
          return toWorld(r, z, ph);
        }),
        true,
      ),
  );
/** twisted magnetic field lines: q = 3 toroidal turns per poloidal turn */
const FIELD_LINES = [0, Math.PI].map((th0) =>
  Array.from({ length: 721 }, (_, k) => {
    const ph = (k / 720) * Math.PI * 2 * Q_SAFETY;
    const [r, z] = dPoint(0.62, th0 + ph / Q_SAFETY);
    return toWorld(r, z, ph);
  }),
);

type TokPhase = "on" | "quench" | "restart";

function SceneTokamak({ B, running, speed, onPhase }: { B: number; running: boolean; speed: number; onPhase: (p: TokPhase) => void }) {
  const beta = P_PLASMA / magPressure(B);
  const stable = beta <= BETA_MAX;
  const st = useRef({ phase: "on" as TokPhase, pt: 0, drift: 0 });
  const lastPhase = useRef<TokPhase>("on");
  const plasmaRef = useRef<THREE.Group>(null!);
  const plasmaMat = useRef<THREE.MeshBasicMaterial>(null!);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null!);
  const wallMat = useRef<THREE.MeshStandardMaterial>(null!);
  const sparkRef = useRef<THREE.Mesh>(null!);
  const ionsRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => ({ hot: new THREE.Color("#fdf4ff"), lost: new THREE.Color("#f87171") }), []);
  const ions = useMemo(
    () =>
      Array.from({ length: N_IONS }, () => ({
        a: 0.12 + Math.random() * 0.68,
        th0: Math.random() * Math.PI * 2,
        ph0: Math.random() * Math.PI * 2,
        w: 0.55 + Math.random() * 0.5,
      })),
    [],
  );

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      const s = st.current;
      s.pt += dt;
      if (s.phase === "on") {
        if (!stable) {
          // too weak a field: the pressure pushes the plasma outward until it hits the wall
          s.drift += dt * (0.35 + 0.6 * Math.min(beta / BETA_MAX - 1, 2));
          if (s.drift >= 1) {
            s.phase = "quench";
            s.pt = 0;
          }
        } else s.drift = Math.max(0, s.drift - dt * 0.6);
      } else if (s.phase === "quench" && s.pt > 1.6) {
        s.phase = "restart";
        s.pt = 0;
        s.drift = 0;
      } else if (s.phase === "restart" && s.pt > 1.0) {
        s.phase = "on";
        s.pt = 0;
      }
      if (s.phase !== lastPhase.current) {
        lastPhase.current = s.phase;
        onPhase(s.phase);
      }

      const glow = s.phase === "quench" ? 0 : s.phase === "restart" ? Math.min(s.pt, 1) : 1;
      const d = s.phase === "on" ? s.drift : 0;
      if (plasmaRef.current) {
        plasmaRef.current.visible = glow > 0.01;
        plasmaRef.current.scale.set(1 + 0.09 * d, 1 + 0.3 * d, 1 + 0.09 * d);
      }
      if (plasmaMat.current) plasmaMat.current.opacity = 0.28 * glow;
      if (coreMat.current) coreMat.current.opacity = 0.45 * glow * (1 - 0.5 * d);
      const flash = s.phase === "quench" ? Math.exp(-s.pt * 3) : 0;
      if (wallMat.current) wallMat.current.emissiveIntensity = flash * 1.6;
      if (sparkRef.current) {
        sparkRef.current.visible = flash > 0.05;
        sparkRef.current.scale.setScalar(0.2 + (1 - flash) * 0.8);
      }

      const mesh = ionsRef.current;
      if (mesh) {
        ions.forEach((ion, i) => {
          if (glow < 0.01) {
            dummy.position.set(0, -999, 0);
            dummy.scale.setScalar(0.0001);
          } else {
            const ph = ion.ph0 + t * ion.w;
            const a = ion.a * (1 + 0.45 * d);
            const [r, z] = dPoint(a, ion.th0 + ph / Q_SAFETY);
            dummy.position.set((r + 0.25 * d) * Math.sin(ph), Y0 + z, (r + 0.25 * d) * Math.cos(ph));
            dummy.scale.setScalar(0.05);
            mesh.setColorAt(i, a > A_WALL * 0.92 ? colors.lost : colors.hot);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    [beta, colors, dummy, ions, onPhase, stable],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <Ground kind="concrete" from={-14} to={14} width={24} tile={4} y={0} />
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <cylinderGeometry args={[5.2, 5.4, 0.2, 64]} />
        <meshStandardMaterial color="#475569" roughness={0.7} />
      </mesh>

      <group position={[0, Y0, 0]}>
        {/* vacuum vessel with a quarter cut away */}
        <mesh castShadow>
          <latheGeometry args={[WALL_V2, 72, Math.PI / 4, Math.PI * 1.5]} />
          <meshStandardMaterial ref={wallMat} color="#cbd5e1" metalness={0.6} roughness={0.4} emissive="#f97316" emissiveIntensity={0} side={THREE.DoubleSide} />
        </mesh>
        {/* hot plasma ring */}
        <group ref={plasmaRef}>
          <mesh>
            <latheGeometry args={[PLASMA_V2, 72]} />
            <meshBasicMaterial ref={plasmaMat} color="#f0abfc" toneMapped={false} transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh>
            <latheGeometry args={[CORE_V2, 72]} />
            <meshBasicMaterial ref={coreMat} color="#fdf4ff" toneMapped={false} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        </group>
        {FIELD_LINES.map((pts, i) => (
          <Line key={i} points={pts} color="#fde68a" lineWidth={1.4} transparent opacity={0.65} />
        ))}
        {/* toroidal-field coils */}
        {COILS.map((curve, i) => (
          <mesh key={i} castShadow>
            <tubeGeometry args={[curve, 72, 0.11, 6, true]} />
            <meshStandardMaterial color="#64748b" metalness={0.65} roughness={0.35} />
          </mesh>
        ))}
        {/* central solenoid drives the current in the plasma */}
        <mesh castShadow>
          <cylinderGeometry args={[1.15, 1.15, KAPPA * A_WALL * 2 + 0.3, 40]} />
          <meshStandardMaterial color="#b45309" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh ref={sparkRef} position={[R_MAJ + A_WALL * 0.95, 0, 0]} visible={false}>
          <sphereGeometry args={[0.6, 20, 14]} />
          <meshBasicMaterial color="#fed7aa" toneMapped={false} transparent opacity={0.85} />
        </mesh>
      </group>
      <instancedMesh ref={ionsRef} args={[undefined, undefined, N_IONS]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>

      <Person position={[-5.7, 0, 0.6]} rotation={[0, 0.7, 0]} scale={0.5} shirt="#f97316" />
      <SceneLabel position={[-5.7, 1.35, 0.6]}>человек 1,75 м</SceneLabel>
      <SceneLabel position={[0, Y0 + 0.1, R_MAJ + 0.3]}>плазма 150 млн K</SceneLabel>
      <SceneLabel position={[-4.6, Y0 + 2.6, -0.6]}>катушки поля</SceneLabel>
      <SceneLabel position={[0, Y0 + 2.75, 0]}>центральный соленоид</SceneLabel>
    </>
  );
}

const STAGE_NAMES: Record<Phase, string> = {
  roll: "налёт и отскок",
  tunnel: "туннелирование сквозь барьер",
  flash: "слияние ядер!",
  fly: "разлёт гелия и нейтрона",
  refill: "новая пара ядер",
};

export function ThermonuclearFusionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, T, Btok } = useControls("Термоядерный синтез", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Слияние D + T: барьер и туннельный эффект": "abstract", "Токамак (как ИТЭР): магнитная «бутылка»": "tokamak" },
    },
    T: { value: 100, min: 10, max: 300, step: 5, label: "Температура плазмы, млн K", render: (get) => get("Термоядерный синтез.scenario") === "abstract" },
    Btok: { value: 5.3, min: 1, max: 8, step: 0.1, label: "B катушек, Тл", render: (get) => get("Термоядерный синтез.scenario") === "tokamak" },
  });
  const isTokamak = scenario === "tokamak";

  const kT = kTkeV(T);
  const E0 = gamowPeak(kT);
  const P = tunnelChance(E0);
  const oneIn = Math.round(1 / P);
  const tunnelAttempt = THREE.MathUtils.clamp(Math.round(Math.log10(1 / P)) - 1, 1, 5) + 1;
  const e = heightOf(E0);

  const [stage, setStage] = useState<Stage>({ phase: "roll", attempt: 1 });
  const [tokPhase, setTokPhase] = useState<TokPhase>("on");

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    setStage({ phase: "roll", attempt: 1 });
    setTokPhase("on");
  }, [clock]);

  const lastScenario = useRef(scenario);
  useEffect(() => {
    if (lastScenario.current === scenario) return;
    lastScenario.current = scenario;
    handleReset();
  }, [scenario, handleReset]);

  const beta = P_PLASMA / magPressure(Btok);
  const stable = beta <= BETA_MAX;
  const larmorMM = ((M_D * Math.sqrt((2 * K_B * T_PLASMA) / M_D)) / (EV * Btok)) * 1000;

  const energyCurve = useMemo(() => {
    const rs = [0, 1, 2, 3, 3.2, R_TOUCH_FM, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80];
    return rs.map((r) => ({ r, V: r < R_TOUCH_FM ? -300 : KE2 / r, E: E0 }));
  }, [E0]);

  const caption = isTokamak ? (
    tokPhase === "quench" ? (
      <>
        <b>Срыв!</b> Плазма коснулась стенки и за доли секунды остыла — её энергия ударила в стенку. Поэтому срывы так опасны для настоящих реакторов. Операторы запускают разряд заново.
      </>
    ) : stable ? (
      <>
        Токамак — «бублик» из магнитного поля. Плазма нагрета до 150 млн K и испарила бы любую стенку, поэтому её держит поле катушек, как невидимая бутылка. Ядра навиваются на силовые линии по спиралям
        радиусом ≈ {larmorMM.toFixed(1)} мм и не долетают до стенок. Поле давит с силой {(magPressure(Btok) / ATM).toFixed(0)} атм, плазма — {(P_PLASMA / ATM).toFixed(1)} атм: β = {(beta * 100).toFixed(1)} % —
        меньше предела ≈ 4 %, плазма держится.
      </>
    ) : (
      <>
        Поле слишком слабое ({Btok.toFixed(1)} Тл): давление плазмы — уже {(beta * 100).toFixed(1)} % от давления поля, больше предела ≈ 4 %. Шнур раздувается и смещается к стенке… Нужно поле не меньше
        ≈ {Math.sqrt((2 * MU0 * P_PLASMA) / BETA_MAX).toFixed(1)} Тл.
      </>
    )
  ) : stage.phase === "roll" || stage.phase === "refill" ? (
    <>
      Ядро дейтерия (D) налетает на ядро трития (T). Оба заряжены положительно и отталкиваются — это склон «вулкана». При {T} млн K энергии хватает подняться лишь на {((E0 / BARRIER_KEV) * 100).toFixed(0)} %
      высоты барьера, и ядро скатывается обратно. Попытка № {stage.attempt}.
    </>
  ) : stage.phase === "tunnel" ? (
    <>
      <b>Туннельный эффект!</b> Ядро — немного волна, поэтому иногда оно «просачивается» сквозь стенку барьера, не забираясь на вершину. При {T} млн K это удаётся в одном столкновении из ≈{" "}
      {oneIn.toLocaleString("ru-RU")}, но ядер в плазме триллионы, поэтому реакции идут постоянно.
    </>
  ) : (
    <>
      Ядерные силы захватили D и T: они слились в <b>гелий-4 и нейтрон</b>. Выделилось {Q_MEV} МэВ: нейтрон уносит 14,1 МэВ, гелий 3,5 МэВ (импульсы равны, лёгкий нейтрон летит в 4 раза быстрее). Это в
      миллионы раз больше, чем даёт горение одной молекулы топлива.
    </>
  );
  const legend: LegendItem[] = isTokamak
    ? [
        { color: "#f0abfc", label: "плазма 150 млн K", kind: "square" },
        { color: "#fde68a", label: "силовая линия поля", kind: "line" },
        { color: "#64748b", label: "катушки тороидального поля", kind: "square" },
        { color: "#b45309", label: "центральный соленоид", kind: "square" },
      ]
    : [
        { color: "#ef4444", label: "протон", kind: "dot" },
        { color: "#cbd5e1", label: "нейтрон", kind: "dot" },
        { color: "#a78bfa", label: "барьер отталкивания", kind: "square" },
        { color: "#991b1b", label: "яма ядерных сил", kind: "square" },
        { color: "#fde047", label: "энергия налетающего ядра", kind: "line" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isTokamak ? { position: [2.2, 7.4, 14.8] as [number, number, number], fov: 45 } : { position: [0, 2.5, 8.0] as [number, number, number], fov: 50 }}
          orbitTarget={isTokamak ? [0, 2.4, 0] : [0, 0.4, 0]}
          simplified={isMobile}
          maxDistance={30}
          minDistance={3}
          bloomThreshold={0.8}
          fogRange={[30, 90]}
        >
          {isTokamak ? (
            <SceneTokamak key={clock.resetNonce} B={Btok} running={clock.running} speed={clock.speed} onPhase={setTokPhase} />
          ) : (
            <SceneBarrier key={clock.resetNonce} e={e} eKeV={E0} tunnelAttempt={tunnelAttempt} running={clock.running} speed={clock.speed} onStage={setStage} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        isTokamak ? (
          <NumberReadouts
            items={[
              { label: "Поле катушек B", value: Btok.toFixed(1), unit: "Тл" },
              { label: "Давление поля B²/2μ₀", value: (magPressure(Btok) / ATM).toFixed(0), unit: "атм" },
              { label: "Давление плазмы 2nkT", value: (P_PLASMA / ATM).toFixed(1), unit: "атм" },
              { label: "β = давление плазмы / давление поля", value: (beta * 100).toFixed(1), unit: "% (предел ≈ 4 %)" },
              { label: "Радиус спирали дейтрона", value: larmorMM.toFixed(1), unit: "мм" },
              { label: "Состояние плазмы", value: tokPhase === "quench" ? "срыв!" : tokPhase === "restart" ? "новый разряд" : stable ? "удерживается" : "раздувается к стенке" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Стадия", value: STAGE_NAMES[stage.phase] },
              { label: "Средняя тепловая энергия ³⁄₂kT", value: (1.5 * kT).toFixed(1), unit: "кэВ" },
              { label: "Энергия сливающихся ядер (пик Гамова)", value: E0.toFixed(0), unit: "кэВ" },
              { label: "Кулоновский барьер", value: BARRIER_KEV.toFixed(0), unit: "кэВ" },
              { label: "Шанс просочиться за один удар", value: `1 из ${oneIn.toLocaleString("ru-RU")}` },
              { label: "Энергия реакции D + T → He + n", value: Q_MEV.toFixed(1), unit: "МэВ" },
            ]}
          />
        )
      }
      graphs={
        isTokamak ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">β — доля давления плазмы от давления поля; выше 4 % плазма срывается</p>
            <LiveChart
              data={BETA_DATA}
              xKey="B"
              xType="number"
              xLabel="B, Тл"
              series={[
                { key: "beta", color: "#f0abfc", label: "β, %" },
                { key: "limit", color: "#f87171", label: "предел ≈ 4 %" },
              ]}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Энергия отталкивания V(r) и энергия ядер E — между ними ядро «просачивается»</p>
            <LiveChart
              data={energyCurve}
              xKey="r"
              xType="number"
              xLabel="r, фм"
              series={[
                { key: "V", color: "#a78bfa", label: "V(r), кэВ (внутри — яма, схема)" },
                { key: "E", color: "#fde047", label: "E ядер, кэВ" },
              ]}
            />
          </div>
        )
      }
      note={
        isTokamak ? (
          <>
            ИТЭР строится во Франции: радиус «бублика» 6,2 м, поле 5,3 Тл, плазма 150 млн K, цель — получить 500 МВт термоядерной мощности, затратив 50 МВт на нагрев. Предел β в несколько процентов
            — это предел устойчивости: при большем давлении плазма выпячивается и выбрасывается на стенку. Кроме поля катушек, в плазме течёт ток в миллионы ампер (его наводит центральный соленоид) —
            вместе они закручивают силовые линии в спирали, вдоль которых бегут частицы.
          </>
        ) : (
          <>
            При 100 млн K тепловая энергия ядер kT ≈ 9 кэВ, а кулоновский барьер D–T ≈ 440 кэВ — классически слияние невозможно. Реакция идёт благодаря туннельному эффекту: шанс просочиться растёт с
            энергией как exp(−34,4/√E), а быстрых ядер в плазме становится всё меньше, поэтому большинство слияний происходит около «пика Гамова» — 20–60 кэВ. На Солнце (15 млн K) так же сливаются
            протоны, только гораздо медленнее — поэтому Солнце горит миллиарды лет.
          </>
        )
      }
    />
  );
}
