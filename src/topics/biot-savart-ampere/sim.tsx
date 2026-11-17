import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Battery, Coil, Compass, Wire } from "@/components/sim/props/electric";
import { CurrentFlow } from "@/components/sim/props/circuit";
import { LabBench } from "@/components/sim/props/environment";
import { badgeTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const MU0 = 4 * Math.PI * 1e-7;
/** the table-top scenes are drawn at 1 scene unit = 10 cm */
const UNIT_M = 0.1;
/** horizontal component of the Earth's field, Тл (points to the geographic north = −z in the scene) */
const B_EARTH = 15e-6;
const BOARD_Y = 0.5;
const PROBE_PERIOD = 8;

interface SamplePoint {
  t: number;
  B: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  r: number;
  B: number;
}

const wireB = (I: number, rUnits: number) => (MU0 * Math.abs(I)) / (2 * Math.PI * rUnits * UNIT_M);

/** Needle angle (Compass convention: from +x toward −z) for the total horizontal field at (x, z) around a vertical current I. */
function needleAngle(I: number, x: number, z: number) {
  const r = Math.hypot(x, z) || 1e-6;
  const B = wireB(I, r) * Math.sign(I);
  // current along +y → B along (sin a, 0, −cos a), a = angle of the position vector
  const bx = (B * z) / r;
  const bz = (-B * x) / r - B_EARTH;
  return Math.atan2(-bz, bx);
}

const RING_SPECS = [
  { R: 0.75, n: 8 },
  { R: 1.5, n: 12 },
];

/** the probe slides along this horizontal direction (x, z) */
const PROBE_DIR = new THREE.Vector2(Math.cos(-0.6), Math.sin(-0.6));

function probeR(t: number) {
  return 1.3 - 0.9 * Math.cos((2 * Math.PI * t) / PROBE_PERIOD);
}

interface SceneContentProps {
  I: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/* ---------- Oersted's experiment: a vertical wire through a board covered with compasses ---------- */
function SceneContent({ I, running, speed, onSample, onLive }: SceneContentProps) {
  const probe = useRef<THREE.Group>(null!);
  const probeNeedle = useRef(0);
  const flow = running ? -Math.sign(I) * Math.min(0.12 * Math.abs(I), 2.5) * speed : 0;

  const handleFrame = useCallback(
    (t: number) => {
      const r = probeR(t);
      const x = r * PROBE_DIR.x;
      const z = r * PROBE_DIR.y;
      if (probe.current) probe.current.position.set(x, BOARD_Y + 0.02, z);
      probeNeedle.current = needleAngle(I, x, z);
    },
    [I],
  );

  const compasses = useMemo(
    () =>
      RING_SPECS.flatMap(({ R, n }) =>
        Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2 + (R > 1 ? Math.PI / n : 0);
          const x = R * Math.cos(a);
          const z = R * Math.sin(a);
          return { x, z, angle: needleAngle(I, x, z) };
        }),
      ),
    [I],
  );
  const wirePath: [number, number, number][] = [
    [0, -0.85, 0],
    [0, 2.3, 0],
  ];

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const r = probeR(t);
          const B = wireB(I, r) * 1e6;
          onSample({ t, B });
          onLive({ t, r, B });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={5} depth={4} height={0.9} />
      {/* a white board on four posts, the wire passes through a hole in its centre */}
      <mesh position={[0, BOARD_Y - 0.015, 0]} receiveShadow>
        <boxGeometry args={[4, 0.03, 4]} />
        <meshStandardMaterial color="#d6d3d1" roughness={0.95} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.85, BOARD_Y / 2, sz * 1.85]}>
            <cylinderGeometry args={[0.04, 0.04, BOARD_Y, 8]} />
            <meshStandardMaterial color="#71717a" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      {/* "north" mark: where the compasses point without current */}
      <FieldArrow origin={[-1.75, BOARD_Y + 0.02, 1.6]} vector={[0, 0, -0.7]} color="#64748b" shaftRadius={0.02} headLength={0.14} headRadius={0.06} />
      <SceneLabel position={[-1.75, BOARD_Y + 0.25, 0.75]}>на север</SceneLabel>

      {/* the vertical copper wire with drifting electrons */}
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 3.15, 16]} />
        <meshStandardMaterial color="#c2773a" metalness={0.85} roughness={0.3} />
      </mesh>
      <CurrentFlow points={wirePath} count={14} speed={flow} radius={0.055} />
      {I !== 0 && <FieldArrow origin={[0.22, 1.5, 0]} vector={[0, Math.sign(I) * 0.6, 0]} color="#facc15" />}
      <SceneLabel position={[0, 2.55, 0]}>{I === 0 ? "провод без тока" : `провод, ток I = ${Math.abs(I)} А ${I > 0 ? "вверх" : "вниз"}`}</SceneLabel>

      {/* faint circles = magnetic field lines */}
      {[0.75, 1.5].map((R) => (
        <mesh key={R} position={[0, BOARD_Y + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[R - 0.012, R + 0.012, 96]} />
          <meshBasicMaterial color="#5eead4" transparent opacity={0.35} />
        </mesh>
      ))}

      {compasses.map((c, i) => (
        <Compass key={i} position={[c.x, BOARD_Y + 0.03, c.z]} angle={c.angle} radius={0.22} />
      ))}

      {/* a handheld magnetometer probe sliding toward and away from the wire */}
      <group ref={probe}>
        <Compass position={[0, 0.03, 0]} angleRef={probeNeedle} radius={0.26} />
        <mesh position={[0.32, 0.06, 0.26]} rotation={[0, -0.6, 0]}>
          <boxGeometry args={[0.4, 0.06, 0.08]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>
        <SceneLabel position={[0, 0.45, 0]}>компас-датчик</SceneLabel>
      </group>
    </>
  );
}

/* ---------- two hanging foil strips with currents ---------- */
const STRIP_TOP = 2.2;
const STRIP_BOTTOM = 0.25;

function stripPoints(x0: number, bow: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const s = i / 12;
    const y = STRIP_BOTTOM + s * (STRIP_TOP - STRIP_BOTTOM);
    pts.push([x0 + bow * 4 * s * (1 - s), y, 0]);
  }
  return pts;
}

function SceneTwoWires({ I1, I2, d, running, speed }: { I1: number; I2: number; d: number; running: boolean; speed: number }) {
  const same = I1 * I2 > 0;
  const F = (MU0 * Math.abs(I1) * Math.abs(I2)) / (2 * Math.PI * d);
  const FMAX = (MU0 * 20 * 20) / (2 * Math.PI * 0.3);
  const bow = F > 0 ? 0.03 + 0.22 * Math.sqrt(F / FMAX) : 0;
  const x1 = -d / 2;
  const x2 = d / 2;
  // attraction bends the strips toward each other, repulsion apart
  const s1 = stripPoints(x1, same ? bow : -bow);
  const s2 = stripPoints(x2, same ? -bow : bow);
  const forceLen = F > 0 ? 0.25 + 0.5 * Math.sqrt(F / FMAX) : 0;
  const k = running ? speed : 0;
  const midY = (STRIP_TOP + STRIP_BOTTOM) / 2;

  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={5} depth={2.6} height={0.9} />
      {/* wooden frame holding the strips */}
      {[-1.6, 1.6].map((x) => (
        <mesh key={x} position={[x, 1.2, 0]} castShadow>
          <boxGeometry args={[0.12, 2.4, 0.12]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.7} />
        </mesh>
      ))}
      {[STRIP_TOP + 0.06, STRIP_BOTTOM - 0.06].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <boxGeometry args={[3.3, 0.1, 0.12]} />
          <meshStandardMaterial color="#a16207" roughness={0.7} />
        </mesh>
      ))}

      {[
        { pts: s1, I: I1, name: "лента 1", x: x1 },
        { pts: s2, I: I2, name: "лента 2", x: x2 },
      ].map((w) => (
        <group key={w.name}>
          <Wire points={w.pts} color="#d4d4d8" radius={0.035} />
          {/* electrons drift against the current */}
          <CurrentFlow points={w.pts} count={10} speed={-Math.sign(w.I) * Math.min(0.12 * Math.abs(w.I), 2.4) * k} />
          {w.I !== 0 && <FieldArrow origin={[w.x + (w.x < 0 ? -0.22 : 0.22), midY + 0.45, 0]} vector={[0, Math.sign(w.I) * 0.5, 0]} color="#facc15" />}
          <SceneLabel position={[w.x, STRIP_TOP + 0.45, 0]}>{`${w.name}: ${Math.abs(w.I)} А ${w.I > 0 ? "↑" : w.I < 0 ? "↓" : ""}`}</SceneLabel>
          {[0.3, 0.55].map((R) => (
            <mesh key={R} position={[w.x, midY - 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[R - 0.01, R + 0.01, 48]} />
              <meshBasicMaterial color="#5eead4" transparent opacity={w.I === 0 ? 0 : 0.35} />
            </mesh>
          ))}
        </group>
      ))}

      {F > 0 && (
        <>
          <FieldArrow origin={[x1 + (same ? bow : -bow), midY, 0.15]} vector={[same ? forceLen : -forceLen, 0, 0]} color="#f87171" />
          <FieldArrow origin={[x2 + (same ? -bow : bow), midY, 0.15]} vector={[same ? -forceLen : forceLen, 0, 0]} color="#f87171" />
        </>
      )}
      <SceneLabel position={[0, STRIP_BOTTOM + 0.35, 0.3]}>{F === 0 ? "нет тока — нет силы" : same ? "токи в одну сторону: притяжение" : "токи навстречу: отталкивание"}</SceneLabel>
    </>
  );
}

/* ---------- electromagnet: a solenoid, its field lines and compasses at the poles ---------- */
const SOL_LEN = 2.4;
const SOL_R = 0.45;
const SOL_Y = 0.75;

function helixPoints(turns: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const steps = turns * 16;
  for (let i = 0; i <= steps; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push([-SOL_LEN / 2 + (i / steps) * SOL_LEN, SOL_Y + Math.sin(a) * SOL_R, Math.cos(a) * SOL_R]);
  }
  return pts;
}

function FieldLoops({ dir }: { dir: number }) {
  const loops = useMemo(() => {
    const out: { geo: THREE.TubeGeometry; arrows: { p: THREE.Vector3; t: THREE.Vector3 }[] }[] = [];
    for (const [yi, yo] of [
      [0.12, 0.85],
      [0.28, 1.4],
    ]) {
      for (const sgn of [1, -1]) {
        const raw: [number, number][] = [
          [-1.25, yi],
          [0, yi],
          [1.25, yi],
          [1.95, (yi + yo) / 2],
          [1.25, yo],
          [0, yo + 0.08],
          [-1.25, yo],
          [-1.95, (yi + yo) / 2],
        ];
        const curve = new THREE.CatmullRomCurve3(
          raw.map(([x, y]) => new THREE.Vector3(x, SOL_Y + sgn * y, 0)),
          true,
          "centripetal",
        );
        const arrows = [0.07, 0.6].map((u) => ({ p: curve.getPointAt(u), t: curve.getTangentAt(u) }));
        out.push({ geo: new THREE.TubeGeometry(curve, 120, 0.012, 5, true), arrows });
      }
    }
    return out;
  }, []);
  useEffect(() => () => loops.forEach((l) => l.geo.dispose()), [loops]);
  return (
    <>
      {loops.map((l, i) => (
        <group key={i}>
          <mesh geometry={l.geo}>
            <meshBasicMaterial color="#5eead4" transparent opacity={0.55} />
          </mesh>
          {l.arrows.map((a, j) => {
            const t = a.t.clone().multiplyScalar(dir);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.normalize());
            return (
              <mesh key={j} position={a.p} quaternion={q}>
                <coneGeometry args={[0.05, 0.14, 10]} />
                <meshBasicMaterial color="#5eead4" />
              </mesh>
            );
          })}
        </group>
      ))}
    </>
  );
}

function SceneSolenoid({ I, turns, running, speed }: { I: number; turns: number; running: boolean; speed: number }) {
  const dirSign = I >= 0 ? 1 : -1;
  const helix = useMemo(() => helixPoints(turns), [turns]);
  const k = running ? speed : 0;
  const nTex = useMemo(() => badgeTexture("N", "#dc2626"), []);
  const sTex = useMemo(() => badgeTexture("S", "#2563eb"), []);
  const startP = helix[0];
  const endP = helix[helix.length - 1];
  // the battery is turned around to reverse the current
  const batLeft: [number, number, number] = [-0.5, 0.16, 1.3];
  const batRight: [number, number, number] = [0.5, 0.16, 1.3];
  const compassAngle = dirSign > 0 ? 0 : Math.PI;

  return (
    <>
      <LabBench position={[0, -0.9, 0]} length={6} depth={3.2} height={0.9} />
      {[-1.05, 1.05].map((x) => (
        <mesh key={x} position={[x, (SOL_Y - SOL_R) / 2, 0]} castShadow>
          <boxGeometry args={[0.25, SOL_Y - SOL_R, 0.5]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.7} />
        </mesh>
      ))}
      {/* cardboard tube the wire is wound on */}
      <mesh position={[0, SOL_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[SOL_R - 0.04, SOL_R - 0.04, SOL_LEN + 0.1, 32, 1, true]} />
        <meshStandardMaterial color="#d6b98c" roughness={0.9} side={THREE.DoubleSide} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <Coil position={[0, SOL_Y, 0]} turns={turns} radius={SOL_R} length={SOL_LEN} wire={0.03} />
      <CurrentFlow points={helix} count={Math.max(30, turns * 3)} speed={Math.sign(I) * Math.min(0.15 * Math.abs(I), 2.4) * k * 3} radius={0.04} />
      <SceneLabel position={[0, SOL_Y + SOL_R + 0.95, 0]}>{`катушка: ${turns} витков, длина 24 см`}</SceneLabel>

      {I !== 0 && <FieldLoops dir={dirSign} />}
      {I !== 0 &&
        [1, -1].map((s) => (
          <sprite key={s} position={[s * (SOL_LEN / 2 + 0.25), SOL_Y + SOL_R + 0.25, 0]} scale={0.32}>
            <spriteMaterial map={s === dirSign ? nTex : sTex} transparent depthTest={false} />
          </sprite>
        ))}

      {/* compasses on posts at both ends: on the axis both needles point the same way, like near a bar magnet */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 2.45, 0, 0]}>
          <mesh position={[0, (SOL_Y - 0.05) / 2, 0]}>
            <cylinderGeometry args={[0.05, 0.08, SOL_Y - 0.05, 12]} />
            <meshStandardMaterial color="#52525b" metalness={0.5} roughness={0.4} />
          </mesh>
          <Compass position={[0, SOL_Y - 0.03, 0]} angle={I === 0 ? Math.PI / 2 : compassAngle} radius={0.24} />
        </group>
      ))}

      <group rotation={[0, I >= 0 ? 0 : Math.PI, 0]} position={[0, 0, 1.3]}>
        <Battery position={[0, 0.16, 0]} voltage="4,5 В" />
      </group>
      <Wire points={[endP, [SOL_LEN / 2, 0.04, 0.9], batRight]} color="#dc2626" radius={0.025} />
      <Wire points={[startP, [-SOL_LEN / 2, 0.04, 0.9], batLeft]} color="#1f2937" radius={0.025} />
    </>
  );
}

export function BiotSavartAmpereSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, I, I1, I2, d, Isol, turns } = useControls("Закон Био-Савара-Лапласа", {
    scenario: {
      value: "wire",
      label: "Жизненный пример",
      options: { "Опыт Эрстеда: провод и компасы": "wire", "Две ленты с током (определение ампера)": "twowires", "Электромагнит (катушка)": "solenoid" },
    },
    I: { value: 8, min: -20, max: 20, step: 1, label: "I, А (ток в проводе)", render: (get) => get("Закон Био-Савара-Лапласа.scenario") === "wire" },
    I1: { value: 10, min: -20, max: 20, step: 1, label: "I₁, А", render: (get) => get("Закон Био-Савара-Лапласа.scenario") === "twowires" },
    I2: { value: 10, min: -20, max: 20, step: 1, label: "I₂, А", render: (get) => get("Закон Био-Савара-Лапласа.scenario") === "twowires" },
    d: { value: 0.8, min: 0.3, max: 2, step: 0.1, label: "расстояние d, м", render: (get) => get("Закон Био-Савара-Лапласа.scenario") === "twowires" },
    Isol: { value: 5, min: -15, max: 15, step: 1, label: "I, А (в соленоиде)", render: (get) => get("Закон Био-Савара-Лапласа.scenario") === "solenoid" },
    turns: { value: 14, min: 6, max: 24, step: 1, label: "число витков", render: (get) => get("Закон Био-Савара-Лапласа.scenario") === "solenoid" },
  });
  const isTwoWires = scenario === "twowires";
  const isSolenoid = scenario === "solenoid";

  const curve = useMemo(() => {
    const pts: { r: number; B: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const r = 3 + (30 - 3) * (i / 40);
      const B = (MU0 * Math.abs(I)) / (2 * Math.PI * r * 0.01);
      pts.push({ r: Number(r.toFixed(1)), B: Number((B * 1e6).toFixed(2)) });
    }
    return pts;
  }, [I]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, r: probeR(0), B: wireB(I, probeR(0)) * 1e6 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, B: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, r: probeR(0), B: 0 });
    setSeries([{ t: 0, B: 0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const Ftwo = (MU0 * Math.abs(I1) * Math.abs(I2)) / (2 * Math.PI * d);
  const SOL_LEN_M = SOL_LEN * UNIT_M;
  const Bsol = MU0 * (turns / SOL_LEN_M) * Math.abs(Isol);
  const fmt = (v: number, dgt = 1) => v.toFixed(dgt).replace(".", ",");

  const caption = isTwoWires ? (
    Ftwo === 0 ? (
      <>Пустите ток хотя бы по одной ленте — пока токов нет, ленты висят прямо.</>
    ) : (
      <>
        Каждая лента с током окружена магнитным полем, а поле соседки действует на её ток (сила Ампера). Токи {I1 * I2 > 0 ? <b>в одну сторону — ленты притягиваются</b> : <b>навстречу — ленты отталкиваются</b>}.
        Сила на метр F/L = μ₀I₁I₂/(2πd) = {fmt(Ftwo * 1e6, 2)} мкН/м (изгиб на рисунке сильно преувеличен).
      </>
    )
  ) : isSolenoid ? (
    Isol === 0 ? (
      <>Тока нет — катушка не магнит, компасы смотрят на север.</>
    ) : (
      <>
        Ток бежит по виткам, и катушка становится <b>магнитом</b>: внутри поле однородно, B = μ₀nI = {fmt(Bsol * 1e3, 2)} мТл, снаружи линии замыкаются, как у полосового магнита. Компасы у торцов
        показывают полюса N и S. Поменяйте знак тока — полюса поменяются местами.
      </>
    )
  ) : I === 0 ? (
    <>Тока нет — все компасы показывают на север (их поворачивает только поле Земли). Включите ток!</>
  ) : (
    <>
      Ток {Math.abs(I)} А создаёт вокруг провода магнитное поле — его линии <b>окружности</b>. Ближние компасы выстраиваются по кругу, дальние почти смотрят на север: поле провода слабеет как 1/r.
      Датчик сейчас в {fmt(live.r * 10, 0)} см от провода: B = {fmt(live.B, 1)} мкТл (поле Земли ≈ 15 мкТл).
    </>
  );
  const legend: LegendItem[] = isTwoWires
    ? [
        { color: "#facc15", label: "направление тока" },
        { color: "#f87171", label: "сила Ампера" },
        { color: "#5eead4", label: "магнитное поле", kind: "line" },
      ]
    : isSolenoid
      ? [
          { color: "#5eead4", label: "линии магнитного поля", kind: "line" },
          { color: "#7dd3fc", label: "электроны в витках", kind: "dot" },
        ]
      : [
          { color: "#facc15", label: "направление тока" },
          { color: "#dc2626", label: "северный конец стрелки", kind: "dot" },
          { color: "#5eead4", label: "линия поля (окружность)", kind: "line" },
        ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isTwoWires ? { position: [0.5, 1.9, 4.6], fov: 50 } : isSolenoid ? { position: [0.8, 2.6, 5.4], fov: 50 } : { position: [0.6, 3.6, 4.6], fov: 50 }}
          orbitTarget={isTwoWires ? [0, 1.2, 0] : isSolenoid ? [0, 0.7, 0] : [0, 0.7, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={2.5}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isTwoWires ? (
            <SceneTwoWires key={clock.resetNonce} I1={I1} I2={I2} d={d} running={clock.running} speed={clock.speed} />
          ) : isSolenoid ? (
            <SceneSolenoid key={clock.resetNonce} I={Isol} turns={turns} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} I={I} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isTwoWires ? (
          <NumberReadouts
            items={[
              { label: "I₁", value: I1.toFixed(1), unit: "А" },
              { label: "I₂", value: I2.toFixed(1), unit: "А" },
              { label: "F/L = μ₀I₁I₂/(2πd)", value: (Ftwo * 1e6).toFixed(3), unit: "мкН/м", color: "#f87171" },
              { label: "Взаимодействие", value: Ftwo === 0 ? "нет" : I1 * I2 > 0 ? "притяжение" : "отталкивание" },
            ]}
          />
        ) : isSolenoid ? (
          <NumberReadouts
            items={[
              { label: "I", value: Isol.toFixed(1), unit: "А" },
              { label: "n = N/L (L = 24 см)", value: (turns / SOL_LEN_M).toFixed(0), unit: "1/м" },
              { label: "B = μ₀nI внутри", value: (Bsol * 1e3).toFixed(3), unit: "мТл", color: "#5eead4" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "I", value: I.toFixed(1), unit: "А" },
              { label: "r датчика", value: (live.r * 10).toFixed(1), unit: "см" },
              { label: "B провода на датчике", value: live.B.toFixed(2), unit: "мкТл" },
              { label: "Направление (сверху)", value: I === 0 ? "—" : I > 0 ? "против часовой" : "по часовой" },
            ]}
          />
        )
      }
      graphs={
        isTwoWires ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Именно эта сила между двумя параллельными проводами исторически определяла единицу силы тока —
            ампер: ток в 1 А в каждом из двух бесконечных проводов на расстоянии 1 м друг от друга создаёт
            силу 2·10⁻⁷ Н на каждый метр длины. Токи в одну сторону — провода притягиваются, в разные —
            отталкиваются.
          </div>
        ) : isSolenoid ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Внутри длинного соленоида поле практически однородно и направлено вдоль оси: B=μ₀nI, где
            n=N/L — число витков на метр. Снаружи поле слабое, а картина силовых линий такая же,
            как у обычного стержневого магнита — катушка с током ведёт себя как электромагнит. Если вставить
            внутрь железный сердечник, поле усилится в сотни раз — так устроены электромагниты кранов и реле.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">B(r) = μ₀I/(2πr)</p>
              <LiveChart data={curve} xKey="r" xType="number" xLabel="r, см" series={[{ key: "B", color: "#5eead4", label: "B, мкТл" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">B(t) на датчике, который ездит к проводу и от него</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "B", color: "#fbbf24", label: "B, мкТл" }]} />
            </div>
          </div>
        )
      }
      note={
        isTwoWires ? (
          <>
            Каждый провод создаёт вокруг себя поле B=μ₀I/(2πd), а второй провод с током в этом поле
            испытывает силу Ампера F=BI₂L. Направление — по правилу левой руки: одинаковые направления
            токов дают притяжение, противоположные — отталкивание.
          </>
        ) : isSolenoid ? (
          <>
            Каждый виток создаёт своё кольцевое поле, а внутри длинного соленоида они складываются в
            почти однородное осевое поле B=μ₀nI. Конец, из которого выходят линии поля, — северный полюс N.
          </>
        ) : (
          <>
            Опыт Эрстеда (1820): прямой провод с током создаёт магнитное поле по окружностям вокруг себя
            (правило буравчика), B=μ₀I/(2πr). Компасы показывают сумму поля провода и поля Земли, поэтому
            вблизи провода они выстраиваются по кругу, а вдали — почти на север. Сцена в масштабе 1 клетка
            ≈ 10 см.
          </>
        )
      }
    />
  );
}
