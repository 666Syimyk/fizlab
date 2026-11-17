import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { Ground, LabBench, Tree } from "@/components/sim/props/environment";
import { Person } from "@/components/sim/props/Person";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

function nWater(lambda: number) {
  return 1.325 + 0.0035 / (lambda * lambda);
}

function rainbowAngles(n: number) {
  const thetaI1 = Math.acos(Math.sqrt((n * n - 1) / 3));
  const thetaR1 = Math.asin(Math.sin(thetaI1) / n);
  const phi1 = 4 * thetaR1 - 2 * thetaI1; // primary, radians from antisolar axis

  const thetaI2 = Math.acos(Math.sqrt((n * n - 1) / 8));
  const thetaR2 = Math.asin(Math.sin(thetaI2) / n);
  const phi2 = 2 * thetaI2 - 6 * thetaR2 + Math.PI; // secondary

  return { phi1, phi2, thetaI1 };
}

const APEX_Y = 1.0;
const BASE_Y = -0.3;
const CAUCHY_A = 1.5;
const CAUCHY_B = 0.004; // um^2
const SRC_X = -3;
const SCREEN_X = 2.2;
/** the prism scene is lifted above the bench */
const LIFT = 2.4;

const COLORS: { name: string; lambda: number; hex: string }[] = [
  { name: "фиолетовый", lambda: 0.4, hex: "#8b5cf6" },
  { name: "синий", lambda: 0.46, hex: "#38bdf8" },
  { name: "голубой", lambda: 0.49, hex: "#5eead4" },
  { name: "зелёный", lambda: 0.53, hex: "#4ade80" },
  { name: "жёлтый", lambda: 0.58, hex: "#fbe14a" },
  { name: "оранжевый", lambda: 0.6, hex: "#fb923c" },
  { name: "красный", lambda: 0.7, hex: "#f87171" },
];

function nOf(lambda: number) {
  return CAUCHY_A + CAUCHY_B / (lambda * lambda);
}

function refractVec(I: [number, number], N: [number, number], n1: number, n2: number): [number, number] | null {
  let nx = N[0];
  let ny = N[1];
  let cosI = -(I[0] * nx + I[1] * ny);
  if (cosI < 0) {
    nx = -nx;
    ny = -ny;
    cosI = -cosI;
  }
  const eta = n1 / n2;
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null;
  const cosT = Math.sqrt(1 - sin2T);
  const k = eta * cosI - cosT;
  return [eta * I[0] + k * nx, eta * I[1] + k * ny];
}

function tracePrism(baseHalf: number, entryY: number, n: number) {
  const apex: [number, number] = [0, APEX_Y];
  const baseLeft: [number, number] = [-baseHalf, BASE_Y];
  const baseRight: [number, number] = [baseHalf, BASE_Y];

  const faceLeftDir = [baseLeft[0] - apex[0], baseLeft[1] - apex[1]];
  const faceLen = Math.hypot(faceLeftDir[0], faceLeftDir[1]);
  const nLeft: [number, number] = [-faceLeftDir[1] / faceLen, faceLeftDir[0] / faceLen];

  const s = (APEX_Y - entryY) / (APEX_Y - BASE_Y);
  const entry: [number, number] = [apex[0] + s * (baseLeft[0] - apex[0]), entryY];

  const d1 = refractVec([1, 0], nLeft, 1, n);
  if (!d1) return null;

  const slopeTerm = (APEX_Y - BASE_Y) / baseHalf;
  const denom = d1[1] + slopeTerm * d1[0];
  if (Math.abs(denom) < 1e-6) return null;
  const t = (APEX_Y - slopeTerm * entry[0] - entry[1]) / denom;
  if (t <= 0) return null;
  const exit: [number, number] = [entry[0] + t * d1[0], entry[1] + t * d1[1]];

  const faceRightDir = [baseRight[0] - apex[0], baseRight[1] - apex[1]];
  const faceRLen = Math.hypot(faceRightDir[0], faceRightDir[1]);
  const nRight: [number, number] = [faceRightDir[1] / faceRLen, -faceRightDir[0] / faceRLen];

  const d2 = refractVec(d1, nRight, n, 1);
  if (!d2) return { entry, exit, d1, d2: null };
  return { entry, exit, d1, d2 };
}

function segMesh(p1: [number, number], p2: [number, number]) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return { cx: (p1[0] + p2[0]) / 2, cy: (p1[1] + p2[1]) / 2 + LIFT, len, angle };
}

/** where an exit ray meets the screen (or a fixed length if it never does) */
function screenHit(exit: [number, number], d: [number, number]): [number, number] {
  if (d[0] > 1e-3) {
    const t = (SCREEN_X - exit[0]) / d[0];
    return [exit[0] + d[0] * t, exit[1] + d[1] * t];
  }
  return [exit[0] + d[0] * 2.6, exit[1] + d[1] * 2.6];
}

function GlassPrism({ baseHalf }: { baseHalf: number }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-baseHalf, BASE_Y);
    shape.lineTo(baseHalf, BASE_Y);
    shape.lineTo(0, APEX_Y);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
    g.translate(0, LIFT, -0.6);
    return g;
  }, [baseHalf]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.28} roughness={0.03} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geo]} />
        <lineBasicMaterial color="#bae6fd" />
      </lineSegments>
    </>
  );
}

interface SceneContentProps {
  baseHalf: number;
  entryY: number;
  running: boolean;
  speed: number;
}

/* ---------- Newton's prism: a beam of white light → prism → spectrum on a screen ---------- */
function SceneContent({ baseHalf, entryY, running, speed }: SceneContentProps) {
  const pulseRefs = useRef<(THREE.Mesh | null)[]>([]);
  const paths = useMemo(
    () =>
      COLORS.map((c) => {
        const tr = tracePrism(baseHalf, entryY, nOf(c.lambda));
        const end = tr?.d2 ? screenHit(tr.exit, tr.d2) : null;
        return { ...c, tr, end };
      }),
    [baseHalf, entryY],
  );

  const handleFrame = useCallback(
    (t: number) => {
      paths.forEach((p, i) => {
        const mesh = pulseRefs.current[i];
        if (!mesh || !p.tr) return;
        const l1 = Math.hypot(p.tr.entry[0] - SRC_X, p.tr.entry[1] - entryY);
        const l2 = Math.hypot(p.tr.exit[0] - p.tr.entry[0], p.tr.exit[1] - p.tr.entry[1]);
        const l3 = p.end ? Math.hypot(p.end[0] - p.tr.exit[0], p.end[1] - p.tr.exit[1]) : 0;
        const dist = (t * 1.4) % (l1 + l2 + l3);
        let x: number;
        let y: number;
        if (dist < l1) {
          const f = dist / l1;
          x = SRC_X + f * (p.tr.entry[0] - SRC_X);
          y = entryY + f * (p.tr.entry[1] - entryY);
        } else if (dist < l1 + l2) {
          const f = (dist - l1) / l2;
          x = p.tr.entry[0] + f * (p.tr.exit[0] - p.tr.entry[0]);
          y = p.tr.entry[1] + f * (p.tr.exit[1] - p.tr.entry[1]);
        } else if (p.end) {
          const f = (dist - l1 - l2) / l3;
          x = p.tr.exit[0] + f * (p.end[0] - p.tr.exit[0]);
          y = p.tr.exit[1] + f * (p.end[1] - p.tr.exit[1]);
        } else {
          x = p.tr.exit[0];
          y = p.tr.exit[1];
        }
        mesh.position.set(x, y + LIFT, 0.02);
      });
    },
    [paths, entryY],
  );

  const incident = paths[0]?.tr ? segMesh([SRC_X, entryY], paths[0].tr.entry) : null;
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, 0]} length={7.4} depth={2.4} height={0.9} />

      {/* a lamp behind a slit gives a narrow beam of white light */}
      <group position={[SRC_X - 0.45, entryY + LIFT, 0]}>
        <mesh>
          <boxGeometry args={[0.8, 0.6, 0.6]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0.41, 0, 0]}>
          <boxGeometry args={[0.02, 0.4, 0.05]} />
          <meshBasicMaterial color="#fffbeb" toneMapped={false} />
        </mesh>
        <mesh position={[0, -(entryY + LIFT) / 2 - 0.15, 0]}>
          <cylinderGeometry args={[0.04, 0.04, entryY + LIFT - 0.3, 10]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <SceneLabel position={[0, 0.6, 0]}>фонарь со щелью: белый луч</SceneLabel>
      </group>

      <GlassPrism baseHalf={baseHalf} />
      <mesh position={[0, LIFT + BASE_Y - (LIFT + BASE_Y) / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.08, LIFT + BASE_Y, 12]} />
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.4} />
      </mesh>
      <SceneLabel position={[0, APEX_Y + LIFT + 0.35, 0]}>стеклянная призма</SceneLabel>

      {incident && (
        <mesh position={[incident.cx, incident.cy, 0]} rotation={[0, 0, incident.angle]}>
          <boxGeometry args={[incident.len, 0.03, 0.03]} />
          <meshBasicMaterial color="#fffbeb" toneMapped={false} />
        </mesh>
      )}
      {paths.map((p) => {
        if (!p.tr) return null;
        const seg1 = segMesh(p.tr.entry, p.tr.exit);
        const seg2 = p.end ? segMesh(p.tr.exit, p.end) : null;
        return (
          <group key={p.name}>
            <mesh position={[seg1.cx, seg1.cy, 0]} rotation={[0, 0, seg1.angle]}>
              <boxGeometry args={[seg1.len, 0.018, 0.018]} />
              <meshBasicMaterial color={p.hex} toneMapped={false} transparent opacity={0.85} />
            </mesh>
            {seg2 && (
              <mesh position={[seg2.cx, seg2.cy, 0]} rotation={[0, 0, seg2.angle]}>
                <boxGeometry args={[seg2.len, 0.02, 0.02]} />
                <meshBasicMaterial color={p.hex} toneMapped={false} />
              </mesh>
            )}
            {p.end && p.end[0] >= SCREEN_X - 0.01 && (
              <mesh position={[SCREEN_X - 0.03, p.end[1] + LIFT, 0]} rotation={[0, -Math.PI / 2, 0]}>
                <planeGeometry args={[0.5, 0.11]} />
                <meshBasicMaterial color={p.hex} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {paths.map((p, i) => (
        <mesh
          key={p.name}
          ref={(el) => {
            pulseRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.045, 10, 10]} />
          <meshBasicMaterial color={p.hex} toneMapped={false} />
        </mesh>
      ))}

      {/* white screen */}
      <group position={[SCREEN_X + 0.02, 1.75, 0]}>
        <mesh>
          <boxGeometry args={[0.04, 3.3, 1.4]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.9} />
        </mesh>
        <mesh position={[0.15, -1.68, 0]}>
          <boxGeometry args={[0.4, 0.06, 1.0]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <SceneLabel position={[0, 1.95, 0]}>экран: спектр</SceneLabel>
      </group>
    </>
  );
}

/* ---------- a rainbow in the rain ---------- */
const EYE: THREE.Vector3Tuple = [0, 1.62, 0];
const SUN_ELEV = (18 * Math.PI) / 180;
/** direction to the antisolar point: straight ahead and below the horizon by the Sun's elevation */
const ANTI = new THREE.Vector3(0, -Math.sin(SUN_ELEV), Math.cos(SUN_ELEV));
const ARC_DIST = 16;
const N_RAIN = 260;

/** Path of a "rainbow ray" through a drop of radius 1 (2D, incoming along +x). */
function dropPath(n: number, internal: 1 | 2) {
  const thetaI = internal === 1 ? Math.acos(Math.sqrt((n * n - 1) / 3)) : Math.acos(Math.sqrt((n * n - 1) / 8));
  let b = Math.sin(thetaI);
  const run = (bb: number) => {
    const pts: [number, number][] = [];
    let p: [number, number] = [-Math.sqrt(1 - bb * bb), bb];
    pts.push(p);
    const first = refractVec([1, 0], p, 1, n);
    if (!first) return null;
    let d: [number, number] = first;
    for (let k = 0; k < internal; k++) {
      const t = -2 * (p[0] * d[0] + p[1] * d[1]);
      p = [p[0] + t * d[0], p[1] + t * d[1]];
      pts.push(p);
      const dot: number = d[0] * p[0] + d[1] * p[1];
      d = [d[0] - 2 * dot * p[0], d[1] - 2 * dot * p[1]];
    }
    const t = -2 * (p[0] * d[0] + p[1] * d[1]);
    p = [p[0] + t * d[0], p[1] + t * d[1]];
    pts.push(p);
    const out = refractVec(d, p, n, 1);
    return out ? { pts, out } : null;
  };
  let r = run(b);
  // light that reaches the observer must leave the drop going back and downward
  if (r && r.out[1] > 0) {
    b = -b;
    r = run(b);
  }
  return { b, ...(r ?? { pts: [] as [number, number][], out: [-1, 0] as [number, number] }) };
}

function RainbowArcs({ showSecondary }: { showSecondary: boolean }) {
  const arcs = useMemo(() => {
    const out: { color: string; radius: number; center: THREE.Vector3; opacity: number }[] = [];
    for (const c of COLORS) {
      const { phi1, phi2 } = rainbowAngles(nWater(c.lambda));
      const eye = new THREE.Vector3(...EYE);
      out.push({ color: c.hex, radius: ARC_DIST * Math.sin(phi1), center: eye.clone().addScaledVector(ANTI, ARC_DIST * Math.cos(phi1)), opacity: 0.6 });
      if (showSecondary) out.push({ color: c.hex, radius: ARC_DIST * Math.sin(phi2), center: eye.clone().addScaledVector(ANTI, ARC_DIST * Math.cos(phi2)), opacity: 0.28 });
    }
    return out;
  }, [showSecondary]);
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ANTI), []);
  return (
    <>
      {arcs.map((a, i) => (
        <mesh key={i} position={a.center} quaternion={q}>
          <torusGeometry args={[a.radius, 0.1, 6, 120]} />
          <meshBasicMaterial color={a.color} transparent opacity={a.opacity} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function Rain({ running, speed }: { running: boolean; speed: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const drops = useMemo(
    () =>
      Array.from({ length: N_RAIN }, (_, i) => ({
        x: Math.sin(i * 12.9898) * 9,
        z: 6 + ((i * 7.31) % 9),
        y0: (i * 3.77) % 9,
        v: 6 + (i % 5),
      })),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const handleFrame = useCallback(
    (t: number) => {
      const m = mesh.current;
      if (!m) return;
      drops.forEach((d, i) => {
        const y = 9 - ((d.y0 + t * d.v) % 9);
        dummy.position.set(d.x, y, d.z);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    },
    [drops, dummy],
  );
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <instancedMesh ref={mesh} args={[undefined, undefined, N_RAIN]} frustumCulled={false}>
        <cylinderGeometry args={[0.012, 0.012, 0.35, 4]} />
        <meshBasicMaterial color="#cbd5e1" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

function DropInset({ showSecondary }: { showSecondary: boolean }) {
  const rays = useMemo(
    () =>
      COLORS.filter((_, i) => i % 2 === 0 || i === COLORS.length - 1).map((c) => {
        const n = nWater(c.lambda);
        return { ...c, p1: dropPath(n, 1), p2: showSecondary ? dropPath(n, 2) : null };
      }),
    [showSecondary],
  );
  const R = 1.1;
  const toV = (p: [number, number]) => new THREE.Vector3(p[0] * R, p[1] * R, 0);
  const seg = (a: THREE.Vector3, b: THREE.Vector3, color: string, w: number, op: number, key: string) => {
    const d = b.clone().sub(a);
    const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    return (
      <mesh key={key} position={a.clone().add(b).multiplyScalar(0.5)} quaternion={qq}>
        <cylinderGeometry args={[w, w, d.length(), 6]} />
        <meshBasicMaterial color={color} transparent opacity={op} toneMapped={false} depthWrite={false} />
      </mesh>
    );
  };
  return (
    // local +x is the direction the sunlight travels (into the scene, +z of the world)
    <group position={[-5.2, 4.6, 7]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh>
        <sphereGeometry args={[R, 40, 28]} />
        <meshStandardMaterial color="#bae6fd" transparent opacity={0.25} roughness={0.05} depthWrite={false} />
      </mesh>
      {rays[0] && seg(new THREE.Vector3(-2.4, rays[0].p1.b * R, 0), toV(rays[0].p1.pts[0]), "#fffbeb", 0.02, 0.9, "in")}
      {rays.map((r) => (
        <group key={r.name}>
          {r.p1.pts.slice(1).map((p, k) => seg(toV(r.p1.pts[k]), toV(p), r.hex, 0.012, 0.8, `a${k}`))}
          {r.p1.pts.length > 0 && seg(toV(r.p1.pts[r.p1.pts.length - 1]), toV(r.p1.pts[r.p1.pts.length - 1]).add(new THREE.Vector3(r.p1.out[0], r.p1.out[1], 0).multiplyScalar(1.6)), r.hex, 0.016, 0.95, "out")}
        </group>
      ))}
      <SceneLabel position={[0, R + 0.45, 0]}>капля (сильно увеличена): преломление → отражение → преломление</SceneLabel>
    </group>
  );
}

function SceneRainbow({ showSecondary, running, speed }: { showSecondary: boolean; running: boolean; speed: number }) {
  return (
    <>
      <Ground kind="grass" from={-30} to={30} width={60} tile={6} tileZ={6} />
      <Person position={[0, 0, 0]} shirt="#2563eb" pants="#1f2937" />
      <SceneLabel position={[0, 2.25, 0]}>Солнце светит человеку в спину</SceneLabel>
      <RainbowArcs showSecondary={showSecondary} />
      <Rain running={running} speed={speed} />
      <DropInset showSecondary={showSecondary} />
      <Tree position={[6, 0, 12]} height={4} seed={3} />
      <Tree position={[-7, 0, 15]} height={5} conifer seed={8} />
      <SceneLabel position={[4.5, 8.4, 13]}>главная радуга ≈ 42° от тени головы</SceneLabel>
      {showSecondary && <SceneLabel position={[-7.5, 11.2, 13]}>вторая радуга ≈ 51°, цвета наоборот</SceneLabel>}
    </>
  );
}

export function DispersionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, apexDeg, entryY, showSecondary } = useControls("Дисперсия света (призма)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Призма Ньютона": "abstract", "Радуга под дождём": "rainbow" },
    },
    apexDeg: { value: 60, min: 40, max: 80, step: 2, label: "Угол призмы A, °", render: (get) => get("Дисперсия света (призма).scenario") === "abstract" },
    entryY: { value: 0.5, min: 0.1, max: 0.8, step: 0.05, label: "Высота входа луча, м", render: (get) => get("Дисперсия света (призма).scenario") === "abstract" },
    showSecondary: { value: true, label: "Показать вторичную радугу", render: (get) => get("Дисперсия света (призма).scenario") === "rainbow" },
  });
  const isRainbow = scenario === "rainbow";
  const primaryDeg = (rainbowAngles(nWater(0.58)).phi1 * 180) / Math.PI;
  const secondaryDeg = (rainbowAngles(nWater(0.58)).phi2 * 180) / Math.PI;

  const baseHalf = (APEX_Y - BASE_Y) * Math.tan((apexDeg * Math.PI) / 360);

  const curve = useMemo(() => {
    const pts: { lambda: number; n: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const lambda = 0.38 + (0.72 - 0.38) * (i / 40);
      pts.push({ lambda: Number(lambda.toFixed(3)), n: Number(nOf(lambda).toFixed(4)) });
    }
    return pts;
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const caption = isRainbow ? (
    <>
      Солнце светит в спину, впереди идёт дождь. В каждой капле свет преломляется, отражается от задней стенки и выходит обратно, а угол выхода зависит от цвета: красный ≈ {fmt(primaryDeg)}°, фиолетовый
      меньше. Поэтому мы видим <b>цветную дугу</b> вокруг точки, куда падает тень головы. {showSecondary ? "Выше — бледная вторая радуга (два отражения в капле), цвета в ней наоборот." : ""}
    </>
  ) : (
    <>
      Белый свет — смесь всех цветов. В стекле разные цвета идут с разной скоростью: <b>фиолетовый преломляется сильнее</b> красного (n = {fmt(nOf(0.4), 3)} против {fmt(nOf(0.7), 3)}). Поэтому из
      призмы выходит веер лучей, и на экране — радужная полоска: так Ньютон доказал, что белый свет составной.
    </>
  );
  const legend: LegendItem[] = isRainbow
    ? [
        { color: "#f87171", label: "красный — снаружи дуги", kind: "line" },
        { color: "#8b5cf6", label: "фиолетовый — внутри", kind: "line" },
      ]
    : [
        { color: "#fffbeb", label: "белый свет", kind: "line" },
        { color: "#f87171", label: "красный (n меньше)", kind: "line" },
        { color: "#8b5cf6", label: "фиолетовый (n больше)", kind: "line" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isRainbow ? { position: [-2.5, 3.0, -7.5] as [number, number, number], fov: 55 } : { position: [0.2, 3.0, 7.2] as [number, number, number], fov: 50 }}
          orbitTarget={isRainbow ? [0, 4.5, 10] : [0, 1.9, 0]}
          simplified={isMobile}
          maxDistance={isRainbow ? 40 : 16}
          minDistance={3}
          bloomThreshold={0.75}
          fogRange={isRainbow ? [30, 80] : [14, 40]}
        >
          {isRainbow ? (
            <SceneRainbow key={clock.resetNonce} showSecondary={showSecondary} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} baseHalf={baseHalf} entryY={entryY} running={clock.running} speed={clock.speed} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isRainbow ? (
          <NumberReadouts
            items={[
              { label: "Угол главной радуги (жёлтый, 580нм)", value: primaryDeg.toFixed(1), unit: "°" },
              { label: "Угол вторичной радуги", value: secondaryDeg.toFixed(1), unit: "°" },
              { label: "n воды (400/700нм)", value: `${nWater(0.4).toFixed(3)} / ${nWater(0.7).toFixed(3)}` },
              { label: "Отражений в капле", value: "1 (главная) / 2 (вторичная)" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "n(фиолетовый, 400нм)", value: nOf(0.4).toFixed(4), color: "#a78bfa" },
              { label: "n(красный, 700нм)", value: nOf(0.7).toFixed(4), color: "#f87171" },
              { label: "Δn (дисперсия)", value: (nOf(0.4) - nOf(0.7)).toFixed(4) },
            ]}
          />
        )
      }
      graphs={
        isRainbow ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Свет входит в каплю, преломляется, один раз отражается от задней внутренней стенки и
            преломляется ещё раз на выходе — суммарное отклонение зависит от показателя преломления,
            а значит и от длины волны (дисперсия), поэтому каждый цвет выходит под своим углом относительно
            направления на Солнце. Наблюдатель видит красный «снаружи», фиолетовый «внутри» дуги —
            геометрически каждая капля даёт свой цвет только тому наблюдателю, для которого угол совпадает.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">n(λ) — формула Коши n=A+B/λ²</p>
            <LiveChart data={curve} xKey="lambda" xType="number" xLabel="λ, мкм" series={[{ key: "n", color: "#5eead4", label: "n" }]} />
          </div>
        )
      }
      note={
        isRainbow ? (
          <>
            Вторичная радуга образуется светом, испытавшим два внутренних отражения в капле — она тусклее
            (часть энергии теряется при доп. отражении) и её порядок цветов обратен главной радуге. Между
            двумя радугами небо заметно темнее (тёмная полоса Александра) — туда почти не попадает свет
            ни от одного, ни от другого механизма отражения. Центр радуги — антисолнечная точка, туда
            падает тень головы наблюдателя, поэтому радугу видно только со Солнцем за спиной.
          </>
        ) : (
          <>
            Показатель преломления стекла зависит от длины волны (формула Коши n=A+B/λ²) — фиолетовый свет
            преломляется сильнее красного. Белый луч входит в призму и расходится веером цветных лучей на
            выходе — это и есть дисперсия, причина радуги и разложения света призмой Ньютона.
          </>
        )
      }
    />
  );
}
