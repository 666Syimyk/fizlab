import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { EnergyBars } from "@/components/sim/EnergyBars";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Ramp } from "@/components/sim/props/mechanics";
import { Person } from "@/components/sim/props/Person";
import { SIT } from "@/components/sim/props/pose";
import { Ground, Tree } from "@/components/sim/props/environment";
import { Wheel } from "@/components/sim/props/vehicles";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const G = 9.8;
const V_SCALE = 0.25;

interface SamplePoint {
  t: number;
  ke: number;
  pe: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  s: number;
  v: number;
  ke: number;
  pe: number;
  work: number;
  power: number;
  done: boolean;
}

/* ---------------- ice slide ---------------- */

interface SlideProps {
  alphaDeg: number;
  L: number;
  m: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onFinished: () => void;
}

function SceneSlide({ alphaDeg, L, m, running, speed, onSample, onLive, onFinished }: SlideProps) {
  const alpha = (alphaDeg * Math.PI) / 180;
  const a = G * Math.sin(alpha);
  const h = L * Math.sin(alpha);
  const run = L * Math.cos(alpha);
  const travel = L - 0.9;
  const tEnd = Math.sqrt((2 * travel) / a);
  const kid = useRef<THREE.Group>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const finished = useRef(false);
  const along = useMemo(() => new THREE.Vector2(Math.cos(alpha), -Math.sin(alpha)), [alpha]);
  const normal = useMemo(() => new THREE.Vector2(Math.sin(alpha), Math.cos(alpha)), [alpha]);

  const stateAt = useCallback(
    (t: number) => {
      const tc = Math.min(t, tEnd);
      const s = 0.5 * a * tc * tc;
      const v = a * tc;
      const currentH = h - (s + 0.45) * Math.sin(alpha);
      const ke = 0.5 * m * v * v;
      const pe = m * G * Math.max(0, currentH);
      return { s, v, ke, pe, work: m * G * (h - currentH) - m * G * 0.45 * Math.sin(alpha), power: m * G * Math.sin(alpha) * v, done: t >= tEnd };
    },
    [tEnd, a, h, alpha, m],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const st = stateAt(t);
      const d = st.s + 0.45;
      const x = -run + along.x * d + normal.x * 0.05;
      const y = h + along.y * d + normal.y * 0.05;
      if (kid.current) kid.current.position.set(x, y, 0);
      vArrow.current?.set([x, y + 1.0, 0], [along.x * st.v * V_SCALE, along.y * st.v * V_SCALE, 0]);
      if (!finished.current && st.done) {
        finished.current = true;
        onLive({ t, ...st });
        onFinished();
      }
    },
    [stateAt, run, h, along, normal, onLive, onFinished],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const st = stateAt(t);
          onSample({ t, ke: st.ke, pe: st.pe });
          onLive({ t, ...st });
        }}
      />
      <Ground kind="snow" from={-12} to={10} width={14} tile={4} tileZ={4} y={-0.01} />
      <Ramp angleDeg={alphaDeg} length={L} width={1.6} surface="snow" />
      {/* ice strip on the slope */}
      <mesh position={[-run / 2, h / 2 + 0.012, 0]} rotation={[0, 0, -alpha]}>
        <boxGeometry args={[L, 0.02, 0.9]} />
        <meshStandardMaterial color="#bfdbfe" roughness={0.1} metalness={0.1} transparent opacity={0.85} />
      </mesh>
      <mesh position={[-run - 0.7, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, h, 2]} />
        <meshStandardMaterial color="#e5edf8" roughness={0.95} />
      </mesh>
      {[-1, 1].map((s) => (
        <Tree key={s} position={[-run - 2.5, 0, s * 3.4]} height={4} conifer seed={s + 4} />
      ))}
      <group ref={kid} rotation={[0, 0, -alpha]}>
        {/* plastic sled (ледянка) */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <boxGeometry args={[0.7, 0.06, 0.48]} />
          <meshStandardMaterial color="#ef4444" roughness={0.4} />
        </mesh>
        <mesh position={[0.36, 0.1, 0]} rotation={[0, 0, 0.9]} castShadow>
          <boxGeometry args={[0.14, 0.04, 0.48]} />
          <meshStandardMaterial color="#ef4444" roughness={0.4} />
        </mesh>
        <Person position={[-0.08, -0.47, 0]} rotation={[0, Math.PI / 2, 0]} scale={0.62} pose={SIT} shirt="#2563eb" pants="#1e293b" cap="#facc15" />
      </group>
      <SceneLabel position={[-run - 0.7, h + 0.5, 0]}>{`вершина горки, h = ${h.toFixed(1)} м`}</SceneLabel>
      <VectorArrow ref={vArrow} color="#4ade80" />
    </>
  );
}

/* ---------------- roller coaster with a vertical loop ---------------- */

type CoasterPhase = "drop" | "loop" | "flewOff" | "done" | "crashed";

interface CoasterLive {
  t: number;
  v: number;
  ke: number;
  pe: number;
  phase: CoasterPhase;
  topPassed: boolean;
  vTop: number;
}

interface TrackPoint {
  p: THREE.Vector3;
  /** heading angle in the xy-plane (radians) */
  ang: number;
  /** loop angle φ (0 at the bottom) or −1 outside the loop */
  phi: number;
}

const LOOP_SHIFT = 0.9;

function buildTrack(h: number, R: number) {
  const xs = -(1.7 * h + 1.5);
  const pts: TrackPoint[] = [];
  // flat start platform
  for (let i = 0; i <= 6; i++) pts.push({ p: new THREE.Vector3(xs - 2 + (i / 6) * 2, h, 0), ang: 0, phi: -1 });
  // descent: y = h(1 + cos(π u))/2, u ∈ [0,1]
  const n1 = 80;
  for (let i = 1; i <= n1; i++) {
    const u = i / n1;
    const x = xs + (0 - xs) * u;
    const y = (h * (1 + Math.cos(Math.PI * u))) / 2;
    const dy = (-h * Math.PI * Math.sin(Math.PI * u)) / 2 / (0 - xs);
    pts.push({ p: new THREE.Vector3(x, y, 0), ang: Math.atan(dy), phi: -1 });
  }
  // loop: x = R sin φ, y = R(1 − cos φ), drifting sideways so the exit clears the entry
  const n2 = 140;
  for (let i = 1; i <= n2; i++) {
    const phi = (i / n2) * Math.PI * 2;
    pts.push({ p: new THREE.Vector3(R * Math.sin(phi), R * (1 - Math.cos(phi)), (LOOP_SHIFT * phi) / (Math.PI * 2)), ang: phi, phi });
  }
  // exit straight
  for (let i = 1; i <= 20; i++) pts.push({ p: new THREE.Vector3((i / 20) * 9, 0, LOOP_SHIFT), ang: 0, phi: -1 });
  // cumulative arc length
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].p.distanceTo(pts[i - 1].p));
  return { pts, lens, total: lens[lens.length - 1], startS: 2 };
}

function sampleTrack(track: ReturnType<typeof buildTrack>, s: number) {
  const { pts, lens } = track;
  let lo = 0;
  let hi = lens.length - 1;
  if (s >= lens[hi]) return { ...pts[hi], p: pts[hi].p.clone() };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - lens[lo]) / Math.max(1e-9, lens[hi] - lens[lo]);
  const p = pts[lo].p.clone().lerp(pts[hi].p, f);
  const ang = pts[lo].ang + (pts[hi].ang - pts[lo].ang) * f;
  const phi = pts[lo].phi < 0 || pts[hi].phi < 0 ? (pts[hi].phi >= 0 ? pts[hi].phi : -1) : pts[lo].phi + (pts[hi].phi - pts[lo].phi) * f;
  return { p, ang, phi };
}

function CoasterCar() {
  return (
    <group>
      <RoundedBox args={[1.3, 0.42, 0.9]} radius={0.12} smoothness={3} position={[0, 0.42, 0]} castShadow>
        <meshStandardMaterial color="#dc2626" metalness={0.4} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0.72, 0.42, 0]} scale={[0.6, 0.55, 1]}>
        <sphereGeometry args={[0.42, 18, 12]} />
        <meshStandardMaterial color="#dc2626" metalness={0.4} roughness={0.35} />
      </mesh>
      {[-0.32, 0.22].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.66, 0]}>
            <boxGeometry args={[0.36, 0.08, 0.74]} />
            <meshStandardMaterial color="#111827" roughness={0.7} />
          </mesh>
          <mesh position={[x - 0.16, 0.85, 0]}>
            <boxGeometry args={[0.08, 0.42, 0.74]} />
            <meshStandardMaterial color="#111827" roughness={0.7} />
          </mesh>
          <mesh position={[x + 0.14, 0.86, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.16, 0.025, 6, 16, Math.PI]} />
            <meshStandardMaterial color="#facc15" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {[-0.42, 0.42].map((x) =>
        [-0.34, 0.34].map((z) => <Wheel key={`${x}${z}`} radius={0.12} width={0.08} position={[x, 0.12, z]} side={z > 0 ? 1 : -1} rim="#e5e7eb" />),
      )}
    </group>
  );
}

function TrackRails({ track }: { track: ReturnType<typeof buildTrack> }) {
  const geos = useMemo(() => {
    const make = (dz: number, dy: number) => {
      const curve = new THREE.CatmullRomCurve3(
        track.pts.map((pt) => {
          // offset perpendicular to the heading inside the xy-plane for the spine, sideways (z) for the rails
          const nx = -Math.sin(pt.ang);
          const ny = Math.cos(pt.ang);
          return new THREE.Vector3(pt.p.x + nx * dy, pt.p.y + ny * dy, pt.p.z + dz);
        }),
      );
      return new THREE.TubeGeometry(curve, track.pts.length * 3, dz === 0 ? 0.09 : 0.045, 8, false);
    };
    return [make(-0.34, 0), make(0.34, 0), make(0, -0.16)];
  }, [track]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  const supports = useMemo(() => track.pts.filter((pt, i) => i % 12 === 0 && pt.p.y > 0.4 && (pt.phi < 0 || pt.phi < 0.6 || pt.phi > Math.PI * 2 - 0.6)), [track]);
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} castShadow>
          <meshStandardMaterial color={i === 2 ? "#1d4ed8" : "#e5e7eb"} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      {supports.map((pt, i) => (
        <mesh key={i} position={[pt.p.x, (pt.p.y - 0.2) / 2, pt.p.z]} castShadow>
          <cylinderGeometry args={[0.08, 0.1, Math.max(0.1, pt.p.y - 0.2), 8]} />
          <meshStandardMaterial color="#64748b" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

interface SceneCoasterProps {
  h: number;
  R: number;
  m: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: CoasterLive) => void;
  onFinished: () => void;
}

function SceneCoaster({ h, R, m, running, speed, onSample, onLive, onFinished }: SceneCoasterProps) {
  const track = useMemo(() => buildTrack(h, R), [h, R]);
  const car = useRef<THREE.Group>(null!);
  const vArrow = useRef<VectorArrowHandle>(null);
  const s = useRef(track.startS);
  const hStart = h + 0.06; // a tiny push off the platform
  const flew = useRef<{ x: number; y: number; z: number; vx: number; vy: number; t0: number; ang: number } | null>(null);
  const crashed = useRef(false);
  const topPassed = useRef(false);
  const vTop = useRef(0);
  const finished = useRef(false);
  const reported = useRef(false);

  const speedAt = useCallback((y: number) => Math.sqrt(Math.max(0, 2 * G * (hStart - y))), [hStart]);

  const handleFixedStep = useCallback(
    (dt: number, t: number) => {
      if (flew.current || finished.current) return;
      const cur = sampleTrack(track, s.current);
      const v = speedAt(cur.p.y);
      if (cur.phi > Math.PI * 0.4 && cur.phi < Math.PI * 1.6) {
        const N = (m * v * v) / R + m * G * Math.cos(cur.phi);
        if (N < 0) {
          flew.current = { x: cur.p.x, y: cur.p.y, z: cur.p.z, vx: v * Math.cos(cur.phi), vy: v * Math.sin(cur.phi), t0: t, ang: cur.phi };
          return;
        }
        if (!topPassed.current && cur.phi >= Math.PI) {
          topPassed.current = true;
          vTop.current = v;
        }
      }
      s.current += Math.max(v, 0.15) * dt;
      if (s.current >= track.total - 0.5) finished.current = true;
    },
    [track, speedAt, m, R],
  );

  const stateAt = useCallback(
    (t: number) => {
      if (flew.current) {
        const f = flew.current;
        const tt = t - f.t0;
        const y = f.y + f.vy * tt - 0.5 * G * tt * tt;
        const x = f.x + f.vx * tt;
        const landed = y <= 0.05;
        if (landed) crashed.current = true;
        const vy = f.vy - G * tt;
        return { pos: new THREE.Vector3(x, Math.max(0.05, y), f.z), ang: landed ? 0 : f.ang + tt * 2, v: landed ? 0 : Math.hypot(f.vx, vy), y: Math.max(0, y), dir: new THREE.Vector2(f.vx, vy) };
      }
      const cur = sampleTrack(track, s.current);
      const v = speedAt(cur.p.y);
      return { pos: cur.p, ang: cur.ang, v, y: cur.p.y, dir: new THREE.Vector2(Math.cos(cur.ang), Math.sin(cur.ang)).multiplyScalar(v) };
    },
    [track, speedAt],
  );

  const phaseOf = useCallback((): CoasterPhase => {
    if (crashed.current) return "crashed";
    if (flew.current) return "flewOff";
    if (finished.current) return "done";
    return sampleTrack(track, s.current).phi >= 0 ? "loop" : "drop";
  }, [track]);

  const emit = useCallback(
    (t: number) => {
      const st = stateAt(t);
      const ke = 0.5 * m * st.v * st.v;
      const pe = m * G * st.y;
      onSample({ t, ke: ke / 1000, pe: pe / 1000 });
      onLive({ t, v: st.v, ke, pe, phase: phaseOf(), topPassed: topPassed.current, vTop: vTop.current });
    },
    [stateAt, m, phaseOf, onSample, onLive],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const st = stateAt(t);
      if (car.current) {
        car.current.position.copy(st.pos);
        car.current.rotation.set(0, 0, st.ang);
      }
      const n = st.dir.clone().normalize();
      if (st.v > 0.05) vArrow.current?.set([st.pos.x - Math.sin(st.ang) * 1.3, st.pos.y + Math.cos(st.ang) * 1.3, st.pos.z], [n.x * st.v * V_SCALE, n.y * st.v * V_SCALE, 0]);
      else vArrow.current?.hide();
      const over = crashed.current || (finished.current && !flew.current);
      if (over && !reported.current) {
        reported.current = true;
        finished.current = true;
        emit(t);
        onFinished();
      }
    },
    [stateAt, emit, onFinished],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} onFixedStep={handleFixedStep} fixedDt={1 / 240} sampleHz={20} onSample={emit} />
      <Ground kind="grass" from={-1.7 * h - 8} to={14} width={20} tile={6} tileZ={6} y={-0.01} />
      <TrackRails track={track} />
      {/* station platform */}
      <mesh position={[-(1.7 * h + 1.5) - 1, h - 0.35, -0.9]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.2, 1.2]} />
        <meshStandardMaterial color="#78716c" roughness={0.8} />
      </mesh>
      <group ref={car}>
        <CoasterCar />
      </group>
      <SceneLabel position={[-(1.7 * h + 1.5) - 1, h + 1.3, 0]}>{`старт, h = ${h.toFixed(1)} м`}</SceneLabel>
      <SceneLabel position={[0, 2 * R + 0.8, LOOP_SHIFT / 2]}>{`петля, R = ${R.toFixed(1)} м`}</SceneLabel>
      <VectorArrow ref={vArrow} color="#4ade80" />
    </>
  );
}

/* ------------------------------------------------------------------ */

const f1 = (n: number) => n.toFixed(1).replace(".", ",");

export function WorkPowerEnergySim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, alphaDeg, L, m, mCar, hOverR, R } = useControls("Работа и энергия", {
    scenario: {
      value: "coaster",
      label: "Жизненный пример",
      options: { "Американские горки (мёртвая петля)": "coaster", "Ледяная горка (ребёнок на ледянке)": "abstract" },
    },
    alphaDeg: { value: 30, min: 10, max: 60, step: 1, label: "крутизна горки α, °", render: (get) => get("Работа и энергия.scenario") === "abstract" },
    L: { value: 5, min: 2, max: 7, step: 0.5, label: "длина спуска L, м", render: (get) => get("Работа и энергия.scenario") === "abstract" },
    m: { value: 30, min: 15, max: 60, step: 1, label: "m ребёнка с ледянкой, кг", render: (get) => get("Работа и энергия.scenario") === "abstract" },
    mCar: { value: 400, min: 150, max: 800, step: 10, label: "m вагонетки, кг", render: (get) => get("Работа и энергия.scenario") === "coaster" },
    R: { value: 2.5, min: 1.5, max: 4, step: 0.1, label: "R петли, м", render: (get) => get("Работа и энергия.scenario") === "coaster" },
    hOverR: { value: 2.7, min: 1.5, max: 3.5, step: 0.05, label: "h / R (высота старта)", render: (get) => get("Работа и энергия.scenario") === "coaster" },
  });

  const coaster = scenario === "coaster";
  const alpha = (alphaDeg * Math.PI) / 180;
  const hRamp = L * Math.sin(alpha);
  const hCoaster = hOverR * R;
  const totalE = coaster ? mCar * G * (hCoaster + 0.06) : m * G * (hRamp - 0.45 * Math.sin(alpha));

  const runKey = `${clock.resetNonce}|${scenario}|${alphaDeg}|${L}|${m}|${mCar}|${R}|${hOverR}`;
  const [live, setLive] = useState<LiveNumbers>({ t: 0, s: 0, v: 0, ke: 0, pe: totalE, work: 0, power: 0, done: false });
  const [series, setSeries] = useState<SamplePoint[]>([]);
  const [coasterLive, setCoasterLive] = useState<CoasterLive>({ t: 0, v: 0, ke: 0, pe: totalE, phase: "drop", topPassed: false, vTop: 0 });

  const play = clock.play;
  useEffect(() => {
    setLive({ t: 0, s: 0, v: 0, ke: 0, pe: totalE, work: 0, power: 0, done: false });
    setSeries([{ t: 0, ke: 0, pe: coaster ? totalE / 1000 : totalE }]);
    setCoasterLive({ t: 0, v: 0, ke: 0, pe: totalE, phase: "drop", topPassed: false, vTop: 0 });
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 700 ? prev : [...prev, p]));
  }, []);
  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const hMin = 2.5 * R;
  let caption;
  if (coaster) {
    const p = coasterLive.phase;
    const vBottom = Math.sqrt(2 * G * (hCoaster + 0.06));
    caption =
      p === "drop" ? (
        <><b>Спуск.</b> Потенциальная энергия mgh превращается в кинетическую: чем ниже вагонетка, тем она быстрее. Внизу будет v = √(2gh) ≈ {f1(vBottom)} м/с.</>
      ) : p === "loop" && !coasterLive.topPassed ? (
        <><b>Петля.</b> Подъём забирает кинетическую энергию обратно. В верхней точке нужна скорость v ≥ √(gR) = {f1(Math.sqrt(G * R))} м/с, иначе рельс перестанет давить на колёса.</>
      ) : p === "loop" ? (
        <><b>Верх пройден</b> со скоростью {f1(coasterLive.vTop)} м/с (нужно не меньше {f1(Math.sqrt(G * R))}). Дальше вниз — скорость снова растёт.</>
      ) : p === "flewOff" || p === "crashed" ? (
        <><b>Сорвалась!</b> Скорости не хватило: рельс перестал давить (N = 0), и вагонетка полетела по параболе. Нужен старт h ≥ 2,5R = {f1(hMin)} м, а сейчас {f1(hCoaster)} м.</>
      ) : (
        <><b>Петля пройдена!</b> Старт h = {f1(hCoaster)} м ≥ 2,5R = {f1(hMin)} м. Энергия mgh = {f1(totalE / 1000)} кДж всё время одна и та же — меняется только её вид.</>
      );
  } else {
    caption =
      live.t < 0.05 ? (
        <><b>Наверху горки:</b> скорость ноль, вся энергия потенциальная — E_п = mgh = {f1(totalE)} Дж.</>
      ) : live.done ? (
        <><b>Внизу:</b> потенциальная энергия целиком стала кинетической, v = √(2gh) = {f1(live.v)} м/с. Сила тяжести совершила работу A = mgh.</>
      ) : (
        <><b>Скатывается:</b> E_п уменьшается, E_к растёт, а их сумма всё время {f1(totalE)} Дж — на ледяной горке трения почти нет.</>
      );
  }

  const legend: LegendItem[] = [
    { color: "#4ade80", label: "скорость v" },
    { color: "#4ade80", label: "E_к — кинетическая", kind: "square" },
    { color: "#f87171", label: "E_п — потенциальная", kind: "square" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={coaster ? { position: [-hCoaster * 0.75, hCoaster * 0.75 + 1, hCoaster * 2.1 + 9], fov: 50 } : { position: [-L * 0.45, L * 0.5 + 1.2, 8], fov: 50 }}
          orbitTarget={coaster ? [-hCoaster * 0.7, hCoaster * 0.45, 0] : [-L * 0.4, L * 0.25, 0]}
          simplified={isMobile}
          maxDistance={40}
          minDistance={3}
          bloomThreshold={0.6}
          fogRange={[20, 60]}
        >
          {coaster ? (
            <SceneCoaster key={runKey} h={hCoaster} R={R} m={mCar} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setCoasterLive} onFinished={handleFinished} />
          ) : (
            <SceneSlide key={runKey} alphaDeg={alphaDeg} L={L} m={m} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} onFinished={handleFinished} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        coaster ? (
          <div className="flex flex-col gap-3">
            <NumberReadouts
              items={[
                { label: "Время t", value: coasterLive.t.toFixed(2), unit: "с" },
                { label: "Скорость v", value: coasterLive.v.toFixed(2), unit: "м/с", color: "#4ade80" },
                { label: "h / R", value: hOverR.toFixed(2), unit: "", color: hOverR >= 2.5 ? "#4ade80" : "#f87171" },
                {
                  label: "Статус",
                  value: coasterLive.phase === "flewOff" || coasterLive.phase === "crashed" ? "сорвался с петли!" : coasterLive.phase === "done" ? "петля пройдена!" : "в движении",
                  color: coasterLive.phase === "flewOff" || coasterLive.phase === "crashed" ? "#f87171" : "#4ade80",
                },
              ]}
            />
            <EnergyBars label="Кинетическая ↔ потенциальная" kinetic={coasterLive.ke / 1000} potential={coasterLive.pe / 1000} total={totalE / 1000} unit="кДж" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <NumberReadouts
              items={[
                { label: "Время t", value: live.t.toFixed(2), unit: "с" },
                { label: "Скорость v", value: live.v.toFixed(2), unit: "м/с", color: "#4ade80" },
                { label: "Работа A=mgh−PE", value: live.work.toFixed(1), unit: "Дж" },
                { label: "Мощность P", value: live.power.toFixed(0), unit: "Вт" },
              ]}
            />
            <EnergyBars label="Кинетическая ↔ потенциальная" kinetic={live.ke} potential={live.pe} total={totalE} />
          </div>
        )
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">Eк(t) и Eп(t){coaster ? ", кДж" : ", Дж"}</p>
          <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "ke", color: "#4ade80", label: "Eк" }, { key: "pe", color: "#f87171", label: "Eп" }]} />
        </div>
      }
      note={
        coaster ? (
          <>
            В верхней точке петли гравитация должна создавать не больше нужного центростремительного ускорения: mg ≤ mv²_top/R.
            Из сохранения энергии mgh = mg·2R + ½mv²_top получаем h_min = 2,5R — знаменитый результат: стартовая высота должна
            быть минимум в 2,5 раза больше радиуса петли, иначе вагонетка отрывается от рельсов, не доехав до верха. (Настоящие
            горки страхуются дополнительными колёсами снизу рельса и делают петлю каплевидной.) Трение не учитывается.
          </>
        ) : (
          <>
            Работа силы тяжести A = mgh переходит в кинетическую энергию: ΔEк = A (теорема о кинетической энергии). Полная
            механическая энергия E = Eк + Eп на ледяной горке почти не меняется, потому что трения почти нет. Скорость внизу
            v = √(2gh) не зависит ни от массы ребёнка, ни от крутизны — только от высоты.
          </>
        )
      }
    />
  );
}
