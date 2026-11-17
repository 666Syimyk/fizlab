import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { Stars, Trail } from "@react-three/drei";
import { SceneLabel } from "@/components/sim/SceneLabel";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Planet, Satellite, SpaceStation, Sun } from "@/components/sim/props/space";

const GM = 60;
const R0 = 6;
const Y_PLANE = 0.12;
const BOUND_RADIUS = R0 * 4.5;
const MAX_SECTORS = 6;
const MAX_TIME = 90;

const V_CIRC = Math.sqrt(GM / R0);
const V_ESC = Math.sqrt((2 * GM) / R0);

interface RealBody {
  label: string;
  RReal: number; // periapsis distance, km
  GMReal: number; // km^3/s^2
  e: number;
  unitR: string;
  unitV: string;
}

const REAL_BODIES: Record<string, RealBody> = {
  // a satellite on a high orbit (r₀ ≈ 19 100 km from Earth's centre): the slider speed is in real km/s
  abstract: { label: "Спутник Земли", RReal: 19113, GMReal: 398600, e: 0, unitR: "км", unitV: "км/с" },
  iss: { label: "МКС вокруг Земли", RReal: 6771, GMReal: 398600, e: 0, unitR: "км", unitV: "км/с" },
  mercury: { label: "Меркурий вокруг Солнца", RReal: 57_909_000 * (1 - 0.206), GMReal: 1.327e11, e: 0.206, unitR: "млн км", unitV: "км/с" },
  mars: { label: "Марс вокруг Солнца", RReal: 227_940_000 * (1 - 0.093), GMReal: 1.327e11, e: 0.093, unitR: "млн км", unitV: "км/с" },
};

function realScale(body: RealBody) {
  const v0Sim = V_CIRC * Math.sqrt(1 + body.e);
  const vCircReal = Math.sqrt(body.GMReal / body.RReal);
  const lengthScale = body.RReal / R0; // real km per sim unit
  const velocityScale = vCircReal / V_CIRC; // real km/s per sim unit/s
  const timeScale = lengthScale / velocityScale; // real seconds per sim second
  return { v0Sim, lengthScale, velocityScale, timeScale, vCircReal, vEscReal: vCircReal * Math.SQRT2 };
}

interface State2D {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

function accel(x: number, z: number) {
  const r = Math.hypot(x, z);
  const f = -GM / (r * r * r);
  return { ax: f * x, az: f * z };
}

function rk4Step(s: State2D, dt: number): State2D {
  const d = (st: State2D) => {
    const { ax, az } = accel(st.x, st.z);
    return { x: st.vx, z: st.vz, vx: ax, vz: az };
  };
  const k1 = d(s);
  const s2 = { x: s.x + (k1.x * dt) / 2, z: s.z + (k1.z * dt) / 2, vx: s.vx + (k1.vx * dt) / 2, vz: s.vz + (k1.vz * dt) / 2 };
  const k2 = d(s2);
  const s3 = { x: s.x + (k2.x * dt) / 2, z: s.z + (k2.z * dt) / 2, vx: s.vx + (k2.vx * dt) / 2, vz: s.vz + (k2.vz * dt) / 2 };
  const k3 = d(s3);
  const s4 = { x: s.x + k3.x * dt, z: s.z + k3.z * dt, vx: s.vx + k3.vx * dt, vz: s.vz + k3.vz * dt };
  const k4 = d(s4);
  return {
    x: s.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    z: s.z + (dt / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
    vx: s.vx + (dt / 6) * (k1.vx + 2 * k2.vx + 2 * k3.vx + k4.vx),
    vz: s.vz + (dt / 6) * (k1.vz + 2 * k2.vz + 2 * k3.vz + k4.vz),
  };
}

function orbitInfo(v0: number) {
  const eps = (v0 * v0) / 2 - GM / R0; // specific orbital energy
  const bound = eps < -1e-9;
  const a = bound ? -GM / (2 * eps) : Infinity; // semi-major axis
  const period = bound ? 2 * Math.PI * Math.sqrt((a * a * a) / GM) : Infinity;
  let regime: string;
  if (Math.abs(v0 - V_CIRC) < 0.03) regime = "круговая";
  else if (v0 < V_ESC - 0.03) regime = "эллиптическая";
  else if (Math.abs(v0 - V_ESC) < 0.03) regime = "параболическая (уход)";
  else regime = "гиперболическая (уход)";
  return { eps, bound, a, period, regime };
}

function buildFanGeometry(points: THREE.Vector2[], y: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const n = points.length;
  const positions = new Float32Array((n + 1) * 3);
  positions[0] = 0;
  positions[1] = y;
  positions[2] = 0;
  for (let i = 0; i < n; i++) {
    positions[(i + 1) * 3] = points[i].x;
    positions[(i + 1) * 3 + 1] = y;
    positions[(i + 1) * 3 + 2] = points[i].y;
  }
  const indices: number[] = [];
  for (let i = 1; i < n; i++) indices.push(0, i, i + 1);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function sectorArea(points: THREE.Vector2[]) {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    sum += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

interface SectorEntry {
  id: number;
  geometry: THREE.BufferGeometry;
  area: number;
}

interface SamplePoint {
  t: number;
  r: number;
  energy: number;
  [key: string]: number;
}

interface LiveNumbers {
  t: number;
  r: number;
  v: number;
  regime: string;
  bound: boolean;
  period: number;
  lastSectorArea: number;
  expectedSectorArea: number;
}

type BodyKind = "abstract" | "iss" | "mercury" | "mars";

interface SceneContentProps {
  v0: number;
  showSectors: boolean;
  kind: BodyKind;
  centerLabel: string;
  bodyLabel: string;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
  onFinished: () => void;
}

function SceneContent({ v0, showSectors, kind, centerLabel, bodyLabel, running, speed, onSample, onLive, onFinished }: SceneContentProps) {
  const info = useMemo(() => orbitInfo(v0), [v0]);
  const L = R0 * v0; // specific angular momentum magnitude at launch (perpendicular velocity)
  const sectorDuration = info.bound ? info.period / 14 : 2.2;
  const expectedSectorArea = 0.5 * L * sectorDuration;

  const planetRef = useRef<THREE.Group>(null!);
  const state = useRef<State2D>({ x: R0, z: 0, vx: 0, vz: v0 });
  const finishedRef = useRef(false);

  const sectorPoints = useRef<THREE.Vector2[]>([new THREE.Vector2(R0, 0)]);
  const sectorElapsed = useRef(0);
  const sectorId = useRef(0);
  const [sectors, setSectors] = useState<SectorEntry[]>([]);

  const handleFixedStep = useCallback(
    (dt: number) => {
      state.current = rk4Step(state.current, dt);
      sectorElapsed.current += dt;
      sectorPoints.current.push(new THREE.Vector2(state.current.x, state.current.z));

      if (showSectors && sectorElapsed.current >= sectorDuration) {
        const pts = sectorPoints.current;
        const area = sectorArea(pts);
        const geometry = buildFanGeometry(pts, Y_PLANE);
        sectorId.current += 1;
        const entry: SectorEntry = { id: sectorId.current, geometry, area };
        setSectors((prev) => {
          const next = [...prev, entry];
          if (next.length > MAX_SECTORS) {
            next.shift()!.geometry.dispose();
          }
          return next;
        });
        sectorPoints.current = [pts[pts.length - 1]];
        sectorElapsed.current = 0;
      }
    },
    [showSectors, sectorDuration],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const s = state.current;
      if (planetRef.current) {
        planetRef.current.position.set(s.x, Y_PLANE, s.z);
        // spacecraft keep their long axis along the flight direction
        if (kind === "abstract" || kind === "iss") planetRef.current.rotation.y = Math.atan2(-s.vz, s.vx);
      }
      const r = Math.hypot(s.x, s.z);

      if (!finishedRef.current) {
        if (!info.bound && r > BOUND_RADIUS) {
          finishedRef.current = true;
          onFinished();
        } else if (t > MAX_TIME) {
          finishedRef.current = true;
          onFinished();
        }
      }
    },
    [info.bound, onFinished, kind],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        fixedDt={1 / 200}
        onFixedStep={handleFixedStep}
        onFrame={handleFrame}
        sampleHz={12}
        onSample={(t) => {
          const s = state.current;
          const r = Math.hypot(s.x, s.z);
          const v = Math.hypot(s.vx, s.vz);
          const energy = (v * v) / 2 - GM / r;
          onSample({ t, r, energy });
          onLive({
            t,
            r,
            v,
            regime: info.regime,
            bound: info.bound,
            period: info.period,
            lastSectorArea: sectors.length ? sectors[sectors.length - 1].area : 0,
            expectedSectorArea,
          });
        }}
      />

      <Stars radius={60} depth={30} count={1200} factor={2.5} fade speed={0.4} />

      {/* central body: the Earth at true scale for the ISS, enlarged Sun for the planets */}
      {kind === "mercury" || kind === "mars" ? (
        <>
          <Sun position={[0, Y_PLANE, 0]} radius={0.85} />
          <pointLight position={[0, 1, 0]} intensity={3} color="#fde68a" distance={40} decay={1} />
        </>
      ) : (
        <Planet kind="earth" position={[0, Y_PLANE, 0]} radius={kind === "iss" ? (R0 * 6371) / 6771 : 2} spin={0.08} />
      )}
      <SceneLabel position={[0, kind === "iss" ? 6.4 : kind === "abstract" ? 2.6 : 1.4, 0]}>{centerLabel}</SceneLabel>

      {sectors.map((s, i) => (
        <mesh key={s.id} geometry={s.geometry}>
          <meshBasicMaterial
            color="#7c6cf5"
            transparent
            opacity={0.1 + 0.28 * ((i + 1) / sectors.length)}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}

      <Trail width={2.2} length={12} color="#5eead4" attenuation={(w) => w} target={planetRef}>
        <group ref={planetRef} position={[R0, Y_PLANE, 0]}>
          {kind === "iss" ? (
            <SpaceStation scale={0.75} />
          ) : kind === "abstract" ? (
            <Satellite scale={0.75} />
          ) : (
            <Planet kind={kind} radius={kind === "mars" ? 0.34 : 0.28} spin={0.3} />
          )}
          <SceneLabel position={[0, 0.65, 0]}>{bodyLabel}</SceneLabel>
        </group>
      </Trail>
    </>
  );
}

export function GravitationKeplerSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { realBody, v0Kms, showSectors } = useControls("Гравитация", {
    realBody: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Запуск спутника: своя скорость": "abstract", "МКС вокруг Земли": "iss", "Меркурий вокруг Солнца": "mercury", "Марс вокруг Солнца": "mars" },
    },
    v0Kms: { value: 5.2, min: 2.3, max: 8.1, step: 0.05, label: "скорость запуска v₀, км/с", render: (get) => get("Гравитация.realBody") === "abstract" },
    showSectors: { value: true, label: "секторы Кеплера" },
  });

  const kind = realBody as BodyKind;
  const body = REAL_BODIES[kind];
  const scale = realScale(body);
  const v0 = kind === "abstract" ? v0Kms / scale.velocityScale : scale.v0Sim;

  const info = useMemo(() => orbitInfo(v0), [v0]);
  const L = R0 * v0;
  const sectorDuration = info.bound ? info.period / 14 : 2.2;
  const expectedSectorArea = 0.5 * L * sectorDuration;

  const initialLive: LiveNumbers = {
    t: 0,
    r: R0,
    v: v0,
    regime: info.regime,
    bound: info.bound,
    period: info.period,
    lastSectorArea: 0,
    expectedSectorArea,
  };
  const [live, setLive] = useState<LiveNumbers>(initialLive);
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, r: R0, energy: (v0 * v0) / 2 - GM / R0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const pause = clock.pause;
  const handleFinished = useCallback(() => pause(), [pause]);

  const runKey = `${clock.resetNonce}|${kind}|${v0}|${showSectors}`;
  const play = clock.play;
  useEffect(() => {
    setLive({ t: 0, r: R0, v: v0, regime: info.regime, bound: info.bound, period: info.period, lastSectorArea: 0, expectedSectorArea });
    setSeries([{ t: 0, r: R0, energy: (v0 * v0) / 2 - GM / R0 }]);
    play();
    // runKey captures every input that restarts the experiment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, play]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const kms = (v: number) => (v * scale.velocityScale).toFixed(2).replace(".", ",");
  const nearSide = live.r < R0 * 1.05;
  let caption;
  if (kind === "iss") {
    caption = (
      <>
        <b>МКС</b> летит всего в ~400 км над Землёй (тонкая полоска между орбитой и поверхностью) со скоростью {kms(live.v)} км/с и облетает планету за ~92 минуты. Она всё время
        падает на Землю, но так быстро летит вбок, что «промахивается».
      </>
    );
  } else if (kind === "mercury" || kind === "mars") {
    caption = (
      <>
        <b>{kind === "mercury" ? "Меркурий" : "Марс"}</b> движется по эллипсу (e = {body.e.toFixed(3).replace(".", ",")}): {nearSide ? "у Солнца — быстрее" : "вдали от Солнца — медленнее"}, сейчас {kms(live.v)} км/с.
        Закрашенные секторы пройдены за равное время и равны по площади — второй закон Кеплера.
      </>
    );
  } else if (!info.bound) {
    caption = (
      <>
        <b>Скорость {v0Kms.toFixed(2).replace(".", ",")} км/с ≥ второй космической</b> ({scale.vEscReal.toFixed(2).replace(".", ",")} км/с на этой высоте): притяжения Земли не хватает, спутник
        улетает навсегда.
      </>
    );
  } else if (Math.abs(v0Kms - scale.vCircReal) < 0.06) {
    caption = (
      <>
        <b>Круговая орбита:</b> скорость равна первой космической для этой высоты ({scale.vCircReal.toFixed(2).replace(".", ",")} км/с). Спутник всё время падает к Земле и всё время
        «промахивается».
      </>
    );
  } else {
    caption = (
      <>
        <b>Эллипс:</b> скорость запуска между первой ({scale.vCircReal.toFixed(2).replace(".", ",")}) и второй ({scale.vEscReal.toFixed(2).replace(".", ",")}) космическими. {nearSide ? "Около Земли спутник быстрее" : "Вдали от Земли он медленнее"} —
        сейчас {kms(live.v)} км/с, а площади секторов за равное время одинаковы.
      </>
    );
  }
  const legend: LegendItem[] = [
    { color: "#5eead4", label: "след орбиты", kind: "line" },
    ...(showSectors ? [{ color: "#7c6cf5", label: "секторы за равное время", kind: "square" as const }] : []),
  ];

  return (
    <SimShell
      legend={legend}
      caption={caption}
      scene={
        <SceneCanvas
          key={kind}
          camera={{ position: [0, 15, 11], fov: 50 }}
          orbitTarget={[0, 0, 0]}
          simplified={isMobile}
          bloom
          contactShadows={false}
          fog={false}
          maxDistance={40}
          minDistance={4}
        >
          <SceneContent
            key={runKey}
            v0={v0}
            showSectors={showSectors}
            kind={kind}
            centerLabel={kind === "iss" || kind === "abstract" ? "Земля" : "Солнце (увеличено)"}
            bodyLabel={kind === "iss" ? "МКС" : kind === "mercury" ? "Меркурий" : kind === "mars" ? "Марс" : "спутник"}
            running={clock.running}
            speed={clock.speed}
            onSample={handleSample}
            onLive={setLive}
            onFinished={handleFinished}
          />
        </SceneCanvas>
      }
      controls={
        <TransportControls
          running={clock.running}
          onToggle={clock.toggle}
          onReset={handleReset}
          speed={clock.speed}
          onSpeedChange={clock.setSpeed}
        />
      }
      numbers={
        <div className="flex flex-col gap-3">
          <NumberReadouts
            items={
              kind !== "abstract"
                ? [
                    { label: "Время t", value: (live.t * scale.timeScale / 60).toFixed(1), unit: "мин" },
                    { label: "Расстояние r", value: (live.r * scale.lengthScale).toFixed(0), unit: body!.unitR },
                    { label: "Скорость v", value: (live.v * scale.velocityScale).toFixed(2), unit: body!.unitV },
                    { label: "Эксцентриситет", value: body!.e.toFixed(3), unit: "" },
                    { label: "Период T", value: live.bound ? (live.period * scale.timeScale / 3600).toFixed(2) : "—", unit: live.bound ? "ч" : "" },
                    { label: "v_круг / v_убег", value: `${scale.vCircReal.toFixed(2)} / ${scale.vEscReal.toFixed(2)}`, unit: body!.unitV },
                  ]
                : [
                    { label: "Время t", value: ((live.t * scale.timeScale) / 3600).toFixed(1), unit: "ч" },
                    { label: "Расстояние r", value: (live.r * scale.lengthScale).toFixed(0), unit: "км" },
                    { label: "Скорость v", value: (live.v * scale.velocityScale).toFixed(2), unit: "км/с" },
                    { label: "Режим", value: live.regime },
                    { label: "Период T", value: live.bound ? ((live.period * scale.timeScale) / 3600).toFixed(1) : "—", unit: live.bound ? "ч" : "" },
                    { label: "1-я / 2-я космич.", value: `${scale.vCircReal.toFixed(2)} / ${scale.vEscReal.toFixed(2)}`, unit: "км/с" },
                  ]
            }
          />
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">Закон площадей Кеплера</p>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Площадь последнего сектора</span>
              <span className="font-mono tabular-nums">{live.lastSectorArea.toFixed(3)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Ожидаемая (½L·Δt)</span>
              <span className="font-mono tabular-nums">{live.expectedSectorArea.toFixed(3)}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-2">
              Все закрашенные секторы соответствуют равным промежуткам времени и имеют равную площадь — тело
              движется быстрее вблизи звезды и медленнее вдали от неё.
            </p>
          </div>
        </div>
      }
      graphs={
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">r(t) — расстояние до {realBody === "iss" ? "Земли" : realBody === "abstract" ? "звезды" : "Солнца"}</p>
            <LiveChart
              data={scale ? series.map((p) => ({ t: (p.t * scale.timeScale) / 60, r: p.r * scale.lengthScale })) : series}
              xKey="t"
              xLabel={scale ? "t, мин" : "t, с"}
              series={[{ key: "r", color: "#5eead4", label: scale ? `r, ${body!.unitR}` : "r, усл.ед." }]}
            />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Удельная энергия ε = v²/2 − GM/r (сохраняется)</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "energy", color: "#f87171", label: "ε" }]} />
          </div>
        </div>
      }
      note={
        kind !== "abstract" ? (
          <>
            Форма орбиты (эксцентриситет e) не зависит от масштаба — законы Кеплера одинаковы для МКС вокруг
            Земли и для планет вокруг Солнца. Числа переведены в реальные единицы (км, км/с, часы), но сама
            траектория считается тем же методом Рунге-Кутты, что и в абстрактном режиме.
          </>
        ) : (
          <>
            Спутник запускают горизонтально на расстоянии ~19 100 км от центра Земли. Траектория интегрируется методом
            Рунге-Кутты 4-го порядка (ускорение a = −GM·r/|r|³). v₁ = √(GM/r₀) — первая космическая (круговая орбита),
            v₂ = √(2GM/r₀) — вторая (уход навсегда); между ними — эллипсы. У поверхности Земли это 7,9 и 11,2 км/с.
          </>
        )
      }
    />
  );
}
