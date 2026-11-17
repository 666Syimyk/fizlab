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
import { ChargedBall, VanDeGraaff } from "@/components/sim/props/electric";
import { SteelBall } from "@/components/sim/props/sport";
import { Ground } from "@/components/sim/props/environment";
import { badgeTexture, woodTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const K_COULOMB = 8.99e9;
const PERIOD = 6;
const RING_RADII = [1, 1.6, 2.3, 3.1];
const FLOOR_Y = -1.1;

interface SamplePoint {
  t: number;
  V: number;
  W: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  r: number;
  V: number;
  W: number;
}

type PathType = "circular" | "radial";

function posAt(t: number, path: PathType, rMin: number, rMax: number) {
  if (path === "circular") {
    const angle = (2 * Math.PI * t) / PERIOD;
    return { r: rMax, angle };
  }
  const mid = (rMin + rMax) / 2;
  const amp = (rMax - rMin) / 2;
  const r = mid - amp * Math.cos((2 * Math.PI * t) / PERIOD);
  return { r, angle: 0 };
}

interface SceneContentProps {
  q: number;
  qTest: number;
  path: PathType;
  rMin: number;
  rMax: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ q, qTest, path, rMin, rMax, running, speed, onSample, onLive }: SceneContentProps) {
  const testRef = useRef<THREE.Group>(null!);
  const V0 = (K_COULOMB * q) / (path === "circular" ? rMax : rMin);

  const handleFrame = useCallback(
    (t: number) => {
      const { r, angle } = posAt(t, path, rMin, rMax);
      if (testRef.current) testRef.current.position.set(r * Math.cos(angle), 0.4, r * Math.sin(angle));
    },
    [path, rMin, rMax],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const { r } = posAt(t, path, rMin, rMax);
          const V = (K_COULOMB * q) / r;
          const W = qTest * (V0 - V);
          onSample({ t, V, W });
          onLive({ t, r, V, W });
        }}
      />

      {/* the field source: a charged Van de Graaff dome, its centre in the plane of motion */}
      <VanDeGraaff position={[0, FLOOR_Y, 0]} height={0.4 - FLOOR_Y} dome={0.3} />
      <sprite position={[0, 0.4, 0]} scale={0.26} renderOrder={2}>
        <spriteMaterial map={badgeTexture("+", "#dc2626")} depthTest={false} transparent />
      </sprite>
      <SceneLabel position={[0, 1.05, 0]}>заряженный купол генератора</SceneLabel>

      {/* horizontal slice of the equipotential spheres: glowing rings at the height of the dome centre */}
      {RING_RADII.map((R) => (
        <group key={R}>
          <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[R, 0.012, 6, 96]} />
            <meshBasicMaterial color="#5eead4" transparent opacity={0.85} toneMapped={false} />
          </mesh>
          <SceneLabel position={[-R * 0.71, 0.55, R * 0.71]}>{`V = ${((K_COULOMB * q) / R / 1000).toFixed(0)} кВ`}</SceneLabel>
        </group>
      ))}

      {/* test charge: a small foil ball on an insulating glass handle */}
      <group ref={testRef}>
        <ChargedBall sign={qTest >= 0 ? 1 : -1} radius={0.12} color={qTest >= 0 ? "#f59e0b" : "#0ea5e9"} />
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.8, 10]} />
          <meshStandardMaterial color="#e0f2fe" transparent opacity={0.55} roughness={0.05} />
        </mesh>
        <mesh position={[0, 1.0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.3, 14]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
        <SceneLabel position={[0, 1.35, 0]}>пробный заряд на ручке</SceneLabel>
      </group>

      <Ground kind="tiles" from={-6} to={6} width={10} tile={2} tileZ={2} y={FLOOR_Y} />
    </>
  );
}

const TERRAIN_N = 36;
const TERRAIN_HALF = 3.2;
const HEIGHT_SCALE = 2.2e-5;
const HEIGHT_CAP = 2.4;

function terrainHeight(x: number, z: number, q: number) {
  const r = Math.max(Math.hypot(x, z), 0.15);
  return THREE.MathUtils.clamp((K_COULOMB * q * HEIGHT_SCALE) / r, -HEIGHT_CAP, HEIGHT_CAP);
}

/** Relief-map colours: lowland green → brown slopes → snowy top; a pit goes blue-green → deep blue. */
const RELIEF_UP = [new THREE.Color("#3f7d20"), new THREE.Color("#a3a03a"), new THREE.Color("#9a6a3a"), new THREE.Color("#f1f5f9")];
const RELIEF_DOWN = [new THREE.Color("#3f7d20"), new THREE.Color("#2f8f83"), new THREE.Color("#1d4ed8"), new THREE.Color("#172554")];
function reliefColor(h: number, out: THREE.Color) {
  const t = Math.min(Math.abs(h) / HEIGHT_CAP, 1) * 3;
  const stops = h >= 0 ? RELIEF_UP : RELIEF_DOWN;
  const i = Math.min(Math.floor(t), 2);
  return out.copy(stops[i]).lerp(stops[i + 1], t - i);
}
const CONTOUR_STEP = 0.4;

interface HillLive {
  t: number;
  h: number;
  v: number;
}

function SceneHill({ q, running, speed, onLive }: { q: number; running: boolean; speed: number; onLive: (n: HillLive) => void }) {
  const geomRef = useRef<THREE.BufferGeometry>(null!);
  const ballRef = useRef<THREE.Group>(null!);
  // on a hill the ball starts near the top; above a pit it starts at the rim
  const ballPos = useRef(q >= 0 ? { x: 0.55, z: 0.35, vx: 0, vz: 0 } : { x: 1.4, z: 2.4, vx: 0, vz: 0 });
  const colors = useMemo(() => new Float32Array(TERRAIN_N * TERRAIN_N * 3), []);

  const positions = useMemo(() => {
    const arr = new Float32Array(TERRAIN_N * TERRAIN_N * 3);
    let i = 0;
    for (let iz = 0; iz < TERRAIN_N; iz++) {
      for (let ix = 0; ix < TERRAIN_N; ix++) {
        const x = -TERRAIN_HALF + (2 * TERRAIN_HALF * ix) / (TERRAIN_N - 1);
        const z = -TERRAIN_HALF + (2 * TERRAIN_HALF * iz) / (TERRAIN_N - 1);
        arr[i * 3] = x;
        arr[i * 3 + 1] = 0;
        arr[i * 3 + 2] = z;
        i++;
      }
    }
    return arr;
  }, []);

  const indices = useMemo(() => {
    const idx: number[] = [];
    for (let iz = 0; iz < TERRAIN_N - 1; iz++) {
      for (let ix = 0; ix < TERRAIN_N - 1; ix++) {
        const a = iz * TERRAIN_N + ix;
        const b = a + 1;
        const c = a + TERRAIN_N;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return idx;
  }, []);

  // relief and its colours depend only on q — rebuild them when the slider moves
  useEffect(() => {
    const g = geomRef.current;
    if (!g) return;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < TERRAIN_N * TERRAIN_N; i++) {
      const h = terrainHeight(pos.getX(i), pos.getZ(i), q);
      pos.setY(i, h);
      reliefColor(h, c);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }, [q]);

  const handleFixedStep = useCallback(
    (dt: number) => {
      const b = ballPos.current;
      const eps = 0.04;
      const gx = (terrainHeight(b.x + eps, b.z, q) - terrainHeight(b.x - eps, b.z, q)) / (2 * eps);
      const gz = (terrainHeight(b.x, b.z + eps, q) - terrainHeight(b.x, b.z - eps, q)) / (2 * eps);
      // a ball rolling on a slope: acceleration along −grad h, light rolling friction
      b.vx += -gx * dt * 4;
      b.vz += -gz * dt * 4;
      b.vx *= 1 - 0.7 * dt;
      b.vz *= 1 - 0.7 * dt;
      const lim = TERRAIN_HALF - 0.2;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      // the wooden rim stops the ball
      if (Math.abs(b.x) > lim) {
        b.x = Math.sign(b.x) * lim;
        b.vx = 0;
      }
      if (Math.abs(b.z) > lim) {
        b.z = Math.sign(b.z) * lim;
        b.vz = 0;
      }
    },
    [q],
  );

  const handleFrame = useCallback(() => {
    const b = ballPos.current;
    if (ballRef.current) ballRef.current.position.set(b.x, terrainHeight(b.x, b.z, q) + 0.14, b.z);
  }, [q]);

  const contours = useMemo(() => {
    const kqs = K_COULOMB * Math.abs(q) * HEIGHT_SCALE;
    const out: { r: number; h: number }[] = [];
    for (let h = CONTOUR_STEP; h < HEIGHT_CAP - 0.05; h += CONTOUR_STEP) {
      const r = kqs / h;
      if (r > 0.3 && r < TERRAIN_HALF - 0.05) out.push({ r, h: Math.sign(q || 1) * h });
    }
    return out;
  }, [q]);
  const wood = useMemo(() => woodTexture("dark", 3), []);

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} onFixedStep={handleFixedStep} fixedDt={1 / 120} sampleHz={15} onSample={(t) => onLive({ t, h: terrainHeight(ballPos.current.x, ballPos.current.z, q), v: Math.hypot(ballPos.current.vx, ballPos.current.vz) })} />

      <mesh>
        <bufferGeometry ref={geomRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          <bufferAttribute attach="index" args={[new Uint16Array(indices), 1]} />
        </bufferGeometry>
        <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* contour lines of the relief = equipotentials */}
      {contours.map((c, i) => (
        <mesh key={i} position={[0, c.h + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[c.r, 0.012, 6, 96]} />
          <meshBasicMaterial color="#f8fafc" transparent opacity={0.8} />
        </mesh>
      ))}
      {contours.length > 0 && <SceneLabel position={[contours[0].r * 0.71, contours[0].h + 0.25, contours[0].r * 0.71]}>горизонталь = эквипотенциаль</SceneLabel>}
      <SceneLabel position={[0, q >= 0 ? HEIGHT_CAP + 0.45 : 0.6, 0]}>{q >= 0 ? "«гора» потенциала: + источник" : "«яма» потенциала: − источник"}</SceneLabel>

      {/* wooden frame of the relief model */}
      {[0, 1, 2, 3].map((k) => {
        const along = k % 2 === 0;
        const sgn = k < 2 ? 1 : -1;
        return (
          <mesh key={k} position={along ? [0, -0.9, sgn * (TERRAIN_HALF + 0.06)] : [sgn * (TERRAIN_HALF + 0.06), -0.9, 0]} castShadow receiveShadow>
            <boxGeometry args={along ? [2 * TERRAIN_HALF + 0.24, 2.4, 0.12] : [0.12, 2.4, 2 * TERRAIN_HALF]} />
            <meshStandardMaterial map={wood} roughness={0.75} />
          </mesh>
        );
      })}
      <Ground kind="concrete" from={-8} to={8} width={14} tile={3} tileZ={3} y={-2.1} />

      <group ref={ballRef}>
        <SteelBall radius={0.14} />
        <SceneLabel position={[0, 0.38, 0]}>шарик = пробный «+» заряд</SceneLabel>
      </group>
    </>
  );
}

export function PotentialSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, qMicro, qTestMicro, path, rMin, rMax, qHillMicro } = useControls("Потенциал электрического поля", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Генератор и пробный заряд": "abstract", "Потенциальная горка (шарик)": "hill" },
    },
    qMicro: { value: 6, min: 1, max: 10, step: 0.5, label: "q источника, мкКл", render: (get) => get("Потенциал электрического поля.scenario") === "abstract" },
    qTestMicro: { value: 1, min: -5, max: 5, step: 0.5, label: "q пробного заряда, мкКл", render: (get) => get("Потенциал электрического поля.scenario") === "abstract" },
    path: { value: "radial", options: { "По окружности (эквипотенциаль)": "circular", "По радиусу": "radial" }, label: "Путь пробного заряда", render: (get) => get("Потенциал электрического поля.scenario") === "abstract" },
    rMin: { value: 1, min: 0.6, max: 1.5, step: 0.1, label: "r мин, м", render: (get) => get("Потенциал электрического поля.scenario") === "abstract" },
    rMax: { value: 3.1, min: 2, max: 3.5, step: 0.1, label: "r макс, м", render: (get) => get("Потенциал электрического поля.scenario") === "abstract" },
    qHillMicro: { value: 6, min: -6, max: 6, step: 0.5, label: "q источника, мкКл", render: (get) => get("Потенциал электрического поля.scenario") === "hill" },
  });
  const hill = scenario === "hill";
  const q = qMicro * 1e-6;
  const qTest = qTestMicro * 1e-6;
  const [hillLive, setHillLive] = useState<HillLive>({ t: 0, h: 0, v: 0 });

  const curve = useMemo(() => {
    const pts: { r: number; V: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const r = 0.5 + (4 - 0.5) * (i / 40);
      pts.push({ r: Number(r.toFixed(2)), V: Number(((K_COULOMB * q) / r / 1000).toFixed(2)) });
    }
    return pts;
  }, [q]);

  const V0init = (K_COULOMB * q) / (path === "circular" ? rMax : rMin);
  const [live, setLive] = useState<LiveNumbers>({ t: 0, r: rMin, V: V0init, W: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, V: V0init, W: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, r: rMin, V: V0init, W: 0 });
    setSeries([{ t: 0, V: V0init, W: 0 }]);
  }, [rMin, V0init]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const caption = hill ? (
    qHillMicro >= 0 ? (
      <>
        Высота рельефа — это потенциал V. Положительный источник делает «гору», и шарик (положительный пробный заряд) <b>сам скатывается вниз</b> — так поле отталкивает одноимённый заряд. Белые
        горизонтали, как на карте местности, — эквипотенциали: вдоль них шарик не катится.
      </>
    ) : (
      <>
        Отрицательный источник делает <b>«яму»</b>: шарик (положительный заряд) скатывается в неё — так разноимённые заряды притягиваются. Сила всегда направлена туда, где потенциал падает быстрее
        всего, поперёк горизонталей.
      </>
    )
  ) : path === "circular" ? (
    <>
      Пробный заряд обходит купол <b>по кругу</b> — по одной эквипотенциали (V = {fmt(live.V / 1000, 0)} кВ). Сила поля всё время перпендикулярна пути, поэтому <b>работа поля W = 0</b>, сколько ни
      ходи по кругу.
    </>
  ) : (
    <>
      Пробный заряд уносят от купола и приносят обратно <b>по радиусу</b>: он пересекает кольца с разным V. Сейчас r = {fmt(live.r, 2)} м, V = {fmt(live.V / 1000, 0)} кВ. Работа поля W = q·(V₁ − V₂) ={" "}
      {fmt(live.W * 1000, 2)} мДж — при возврате в начало она снова станет нулём.
    </>
  );
  const legend: LegendItem[] = hill
    ? [
        { color: "#f8fafc", label: "горизонталь = эквипотенциаль", kind: "line" },
        { color: "#cbd5e1", label: "шарик — пробный заряд", kind: "dot" },
      ]
    : [
        { color: "#5eead4", label: "эквипотенциаль (V = const)", kind: "line" },
        { color: qTestMicro >= 0 ? "#f59e0b" : "#0ea5e9", label: "пробный заряд", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={hill ? { position: [5, 5, 6.5], fov: 50 } : { position: [0, 4.2, 7.6], fov: 50 }}
          orbitTarget={hill ? [0, 0.2, 0] : [0, 0.1, 0]}
          simplified={isMobile}
          maxDistance={22}
          minDistance={3}
          bloomThreshold={0.6}
          fogRange={[16, 40]}
        >
          {hill ? (
            <SceneHill key={clock.resetNonce} q={qHillMicro * 1e-6} running={clock.running} speed={clock.speed} onLive={setHillLive} />
          ) : (
            <SceneContent key={clock.resetNonce} q={q} qTest={qTest} path={path as PathType} rMin={rMin} rMax={rMax} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        hill ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: hillLive.t.toFixed(2), unit: "с" },
              { label: "Высота (∝V) под шариком", value: hillLive.h.toFixed(2), unit: "усл.ед." },
              { label: "Скорость скатывания", value: hillLive.v.toFixed(2), unit: "усл.ед./с" },
              { label: "Знак заряда-источника", value: qHillMicro >= 0 ? "положительный (горка)" : "отрицательный (яма)" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "r(t) пробного заряда", value: live.r.toFixed(2), unit: "м" },
              { label: "V(r) = kq/r", value: (live.V / 1000).toFixed(2), unit: "кВ" },
              { label: "Работа поля W = qΔV", value: (live.W * 1000).toFixed(3), unit: "мДж" },
            ]}
          />
        )
      }
      graphs={
        hill ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Шарик всегда скатывается в сторону наискорейшего убывания высоты — то есть в направлении −∇V,
            которое и есть направление вектора напряжённости поля E. Положительный заряд-источник создаёт
            «горку», с которой скатывается положительный пробный заряд (отталкивание); отрицательный —
            «яму», куда он падает (притяжение).
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">V(r) точечного заряда</p>
              <LiveChart data={curve} xKey="r" xType="number" xLabel="r, м" series={[{ key: "V", color: "#5eead4", label: "V, кВ" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Работа поля W(t) при перемещении пробного заряда</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "W", color: "#fbbf24", label: "W, Дж" }]} />
            </div>
          </div>
        )
      }
      note={
        hill ? (
          <>
            Потенциал играет роль «рельефа»: E=−∇V — сила, действующая на положительный пробный заряд, всегда
            направлена вниз по склону. Это точная механическая аналогия — высота холма соответствует
            потенциальной энергии, и шарик, как и заряд, самопроизвольно движется туда, где энергия меньше.
          </>
        ) : (
          <>
            Бирюзовые кольца — эквипотенциальные линии (V=kq/r=const). При движении пробного заряда «по
            окружности» работа поля W=q(V₁−V₂)=0 — заряд остаётся на одной эквипотенциали. При движении «по
            радиусу» потенциал и работа меняются — это и есть физический смысл разности потенциалов.
          </>
        )
      }
    />
  );
}
