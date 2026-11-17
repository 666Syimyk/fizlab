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
import { Person } from "@/components/sim/props/Person";
import { STAND, walkPose, type PoseAngles } from "@/components/sim/props/pose";
import { DistancePost, Ground } from "@/components/sim/props/environment";
import { canvasTexture, concreteTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

/* ================= 1. distance + shield ================= */
/** dose-rate constant of cobalt-60, µSv·m²/(h·MBq) */
const GAMMA_CO60 = 0.35;
/** natural background, µSv/h */
const BACKGROUND = 0.1;
const PERIOD = 8;
const R_MIN = 0.6;
const R_MAX = 5;
const SOURCE_Y = 1.06;
const SHIELD_X = 0.3;

type ShieldKind = "lead" | "concrete" | "water";
/** narrow-beam attenuation for the 1.25 MeV gamma rays of Co-60 */
const MATERIALS: Record<string, { mu: number; kind: ShieldKind; short: string }> = {
  "Свинец (μ = 0,67 /см)": { mu: 0.67, kind: "lead", short: "свинец" },
  "Бетон (μ = 0,13 /см)": { mu: 0.13, kind: "concrete", short: "бетон" },
  "Вода (μ = 0,063 /см)": { mu: 0.063, kind: "water", short: "вода" },
};
const SHIELD_COLOR: Record<ShieldKind, string> = { lead: "#6b7280", concrete: "#a8a29e", water: "#38bdf8" };

const doseRate = (activity: number, r: number, pass: number) => (GAMMA_CO60 * activity * pass) / (r * r) + BACKGROUND;
const rAt = (t: number) => R_MIN + (R_MAX - R_MIN) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / PERIOD));
const vAt = (t: number) => ((R_MAX - R_MIN) * Math.PI * Math.sin((2 * Math.PI * t) / PERIOD)) / PERIOD;

function fmtTime(hours: number) {
  if (hours < 1) return `≈ ${Math.max(1, Math.round(hours * 60))} мин`;
  if (hours < 48) return `≈ ${hours.toFixed(hours < 10 ? 1 : 0).replace(".", ",")} ч`;
  if (hours < 24 * 365) return `≈ ${Math.round(hours / 24)} сут`;
  return "больше года";
}
const fmtRate = (x: number) => x.toFixed(x < 10 ? 1 : 0).replace(".", ",");
/** «в 3 раза», «в 5 раз», «в 22 раза» */
const razWord = (n: number) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "раза" : "раз");

function trefoilTexture() {
  return canvasTexture("radiation-trefoil", 256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#facc15";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    const cx = w / 2;
    const cy = h / 2;
    const R = w * 0.38;
    const r0 = w * 0.08;
    ctx.fillStyle = "#111111";
    for (const c of [-Math.PI / 6, (-5 * Math.PI) / 6, Math.PI / 2]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, c - Math.PI / 6, c + Math.PI / 6);
      ctx.arc(cx, cy, r0 * 1.5, c + Math.PI / 6, c - Math.PI / 6, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, Math.PI * 2);
    ctx.fill();
  });
}

interface Gamma {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  checked: boolean;
}
const N_GAMMA = 160;
const GAMMA_SPEED = 3.2;
const CONE_COS = Math.cos((38 * Math.PI) / 180);

interface SamplePoint {
  t: number;
  rate: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  r: number;
  rate: number;
}

interface ShieldSceneProps {
  activity: number;
  mu: number;
  xShield: number;
  kind: ShieldKind;
  reading: string;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneShield({ activity, mu, xShield, kind, reading, running, speed, onSample, onLive }: ShieldSceneProps) {
  const walker = useRef<THREE.Group>(null!);
  const poseRef = useRef<PoseAngles>({ ...STAND });
  const stride = useRef(0);
  const gammas = useRef<Gamma[]>([]);
  const spawnAcc = useRef(0);
  const gammaRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const pass = Math.exp(-mu * xShield);
  const thick = Math.max(xShield / 100, 0.012);

  const handleFrame = useCallback(
    (t: number, dt: number) => {
      // the person walks to the source and back at an ordinary 1 m/s
      const r = rAt(t);
      const v = vAt(t);
      const w = walker.current;
      if (w) {
        w.position.x = r;
        const target = v >= 0 ? Math.PI / 2 : -Math.PI / 2;
        w.rotation.y += (target - w.rotation.y) * Math.min(1, dt * 6);
      }
      stride.current += Math.abs(v) * dt * 4.5;
      const k = Math.min(Math.abs(v) / 0.6, 1);
      const walk = walkPose(stride.current);
      const p = poseRef.current;
      (Object.keys(STAND) as (keyof PoseAngles)[]).forEach((key) => {
        p[key] = STAND[key] + (walk[key] - STAND[key]) * k;
      });

      // gamma quanta fly out of the capsule; the shield stops a share e^(−μx) of them
      const list = gammas.current;
      spawnAcc.current = Math.min(spawnAcc.current + dt * (20 + activity * 0.12), 4);
      while (spawnAcc.current >= 1 && list.length < N_GAMMA) {
        spawnAcc.current -= 1;
        const u = CONE_COS + Math.random() * (1 - CONE_COS);
        const s = Math.sqrt(1 - u * u);
        const ph = Math.random() * Math.PI * 2;
        list.push({ x: 0.04, y: SOURCE_Y, z: 0, dx: u, dy: s * Math.cos(ph), dz: s * Math.sin(ph), checked: false });
      }
      const front = SHIELD_X - thick / 2;
      gammas.current = list.filter((g) => {
        g.x += g.dx * GAMMA_SPEED * dt;
        g.y += g.dy * GAMMA_SPEED * dt;
        g.z += g.dz * GAMMA_SPEED * dt;
        if (xShield > 0 && !g.checked && g.x >= front) {
          g.checked = true;
          if (Math.random() > pass) return false;
        }
        return g.x < R_MAX + 1.2 && g.y > 0;
      });
      const mesh = gammaRef.current;
      if (mesh) {
        for (let i = 0; i < N_GAMMA; i++) {
          const g = gammas.current[i];
          if (g) {
            dummy.position.set(g.x, g.y, g.z);
            dummy.scale.setScalar(0.022);
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
    [activity, dummy, pass, thick, xShield],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={10}
        onSample={(t) => {
          const r = rAt(t);
          const rate = doseRate(activity, r, pass);
          onSample({ t, rate });
          onLive({ t, r, rate });
        }}
      />
      <Ground kind="concrete" from={-4} to={8} width={8} tile={3} y={0} />
      {[1, 2, 3, 4, 5].map((m) => (
        <DistancePost key={m} text={`${m} м`} height={0.45} position={[m, 0, -0.9]} />
      ))}

      {/* the source: a cobalt-60 capsule on a small table, its open lead container and a warning sign */}
      <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.04, 0.45]} />
        <meshStandardMaterial color="#d4d4d8" metalness={0.5} roughness={0.4} />
      </mesh>
      {[
        [-0.26, -0.18],
        [0.26, -0.18],
        [-0.26, 0.18],
        [0.26, 0.18],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.49, z]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.98, 8]} />
          <meshStandardMaterial color="#71717a" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0.02, SOURCE_Y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.1, 16]} />
        <meshStandardMaterial color="#e5e7eb" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0.02, SOURCE_Y, 0]}>
        <sphereGeometry args={[0.08, 16, 12]} />
        <meshBasicMaterial color="#d9f99d" toneMapped={false} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <mesh position={[-0.18, 1.12, 0.05]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.2, 24]} />
        <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[-0.6, 0.75, -0.35]}>
        <cylinderGeometry args={[0.02, 0.02, 1.5, 8]} />
        <meshStandardMaterial color="#71717a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-0.6, 1.62, -0.33]}>
        <planeGeometry args={[0.36, 0.36]} />
        <meshBasicMaterial map={trefoilTexture()} toneMapped={false} />
      </mesh>
      <SceneLabel position={[0, 1.45, 0]}>кобальт-60</SceneLabel>

      {/* the shield */}
      {xShield > 0 &&
        (kind === "water" ? (
          <group position={[SHIELD_X, 0.85, 0]}>
            <mesh>
              <boxGeometry args={[thick, 1.7, 1.1]} />
              <meshStandardMaterial color="#38bdf8" transparent opacity={0.45} roughness={0.1} depthWrite={false} />
            </mesh>
            <mesh>
              <boxGeometry args={[thick + 0.02, 1.72, 1.12]} />
              <meshStandardMaterial color="#e0f2fe" transparent opacity={0.15} roughness={0.05} depthWrite={false} />
            </mesh>
          </group>
        ) : (
          <mesh position={[SHIELD_X, 0.85, 0]} castShadow receiveShadow>
            <boxGeometry args={[thick, 1.7, 1.1]} />
            {kind === "concrete" ? (
              <meshStandardMaterial map={concreteTexture()} color="#d6d3d1" roughness={0.9} />
            ) : (
              <meshStandardMaterial color="#6b7280" metalness={0.45} roughness={0.5} />
            )}
          </mesh>
        ))}

      <instancedMesh ref={gammaRef} args={[undefined, undefined, N_GAMMA]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color="#bef264" toneMapped={false} />
      </instancedMesh>

      {/* a person with a dosimeter clipped to the chest */}
      <group ref={walker} position={[R_MIN, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Person poseRef={poseRef} shirt="#2563eb" pants="#334155" />
        <mesh position={[0.08, 1.28, 0.14]}>
          <boxGeometry args={[0.07, 0.1, 0.025]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>
        <SceneLabel position={[0, 2.08, 0]}>{reading}</SceneLabel>
      </group>
    </>
  );
}

/* ================= 2. everyday doses as objects ================= */
interface DoseItem {
  name: string;
  uSv: number;
  color: string;
  model: "banana" | "tooth" | "plane" | "house" | "ct" | "suit";
}
const DOSE_ITEMS: DoseItem[] = [
  { name: "банан", uSv: 0.1, color: "#4ade80", model: "banana" },
  { name: "рентген зуба", uSv: 5, color: "#4ade80", model: "tooth" },
  { name: "перелёт 8 ч", uSv: 40, color: "#a3e635", model: "plane" },
  { name: "год жизни", uSv: 2400, color: "#fbbf24", model: "house" },
  { name: "КТ груди", uSv: 7000, color: "#fb923c", model: "ct" },
  { name: "лучевая болезнь", uSv: 4000000, color: "#f87171", model: "suit" },
];
const fmtDose = (uSv: number) => (uSv >= 1000 ? `${(uSv / 1000).toLocaleString("ru-RU")} мЗв` : `${uSv.toLocaleString("ru-RU")} мкЗв`);
const BACKGROUND_PER_DAY = 2400 / 365;
const BANANA_CURVE = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.28, 0.12, 0), new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0.28, 0.12, 0));

function DoseModel({ model }: { model: DoseItem["model"] }) {
  switch (model) {
    case "banana":
      return (
        <group position={[0, 0.12, 0]}>
          <mesh castShadow>
            <tubeGeometry args={[BANANA_CURVE, 24, 0.065, 10, false]} />
            <meshStandardMaterial color="#facc15" roughness={0.55} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.28, 0.12, 0]}>
              <sphereGeometry args={[0.03, 8, 6]} />
              <meshStandardMaterial color="#713f12" />
            </mesh>
          ))}
        </group>
      );
    case "tooth":
      return (
        <group position={[0, 0.2, 0]}>
          <mesh position={[0, 0.12, 0]} scale={[1, 0.8, 0.9]} castShadow>
            <sphereGeometry args={[0.16, 20, 16]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.065, -0.06, 0]} rotation={[0, 0, s * 0.12]} castShadow>
              <cylinderGeometry args={[0.055, 0.02, 0.24, 10]} />
              <meshStandardMaterial color="#f1f5f9" roughness={0.35} />
            </mesh>
          ))}
        </group>
      );
    case "plane":
      return (
        <group position={[0, 0.25, 0]} rotation={[0, 0.5, 0.12]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.06, 0.05, 0.7, 14]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.4} />
          </mesh>
          <mesh position={[0.38, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.06, 0.1, 14]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.4} />
          </mesh>
          <mesh position={[0.02, 0, 0]} castShadow>
            <boxGeometry args={[0.16, 0.012, 0.75]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
          </mesh>
          <mesh position={[-0.3, 0.08, 0]}>
            <boxGeometry args={[0.1, 0.14, 0.012]} />
            <meshStandardMaterial color="#2563eb" roughness={0.4} />
          </mesh>
          <mesh position={[-0.3, 0.01, 0]}>
            <boxGeometry args={[0.08, 0.01, 0.26]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.4} />
          </mesh>
        </group>
      );
    case "house":
      return (
        <group position={[0, 0.17, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.46, 0.34, 0.4]} />
            <meshStandardMaterial color="#fde68a" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[0.38, 0.26, 4]} />
            <meshStandardMaterial color="#b45309" roughness={0.7} />
          </mesh>
          <mesh position={[0.06, -0.06, 0.201]}>
            <planeGeometry args={[0.1, 0.2]} />
            <meshStandardMaterial color="#78350f" />
          </mesh>
        </group>
      );
    case "ct":
      return (
        <group position={[0, 0.3, 0]}>
          <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[0.22, 0.09, 14, 36]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.35} />
          </mesh>
          <mesh position={[0.05, -0.1, 0]} castShadow>
            <boxGeometry args={[0.7, 0.04, 0.16]} />
            <meshStandardMaterial color="#94a3b8" roughness={0.4} />
          </mesh>
        </group>
      );
    case "suit":
      return <Person scale={0.42} shirt="#e5e7eb" pants="#e5e7eb" cap="#e5e7eb" />;
  }
}

function SceneDoseScale() {
  const SPACING = 1.3;
  const N = DOSE_ITEMS.length;
  return (
    <>
      <Ground kind="tiles" from={-6} to={6} width={6} tile={2} y={0} />
      {DOSE_ITEMS.map((d, i) => {
        const x = (i - (N - 1) / 2) * SPACING;
        // bar height on a logarithmic scale: every step of the bar is ×10 in dose
        const h = (Math.log10(d.uSv) + 1.5) * 0.42;
        return (
          <group key={d.name} position={[x, 0, 0]}>
            <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.34, 0.38, 0.6, 32]} />
              <meshStandardMaterial color="#27272a" roughness={0.6} />
            </mesh>
            <group position={[0, 0.6, 0]}>
              <DoseModel model={d.model} />
            </group>
            <mesh position={[0, h / 2, -0.7]}>
              <boxGeometry args={[0.32, h, 0.12]} />
              <meshStandardMaterial color={d.color} emissive={d.color} emissiveIntensity={0.35} transparent opacity={0.8} />
            </mesh>
            <SceneLabel position={[0, h + 0.25, -0.7]}>{fmtDose(d.uSv)}</SceneLabel>
            <SceneLabel position={[0, i % 2 === 0 ? -0.25 : -0.6, 0.3]}>{d.name}</SceneLabel>
          </group>
        );
      })}
    </>
  );
}

export function DosimetryProtectionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, I0, material, xShield } = useControls("Дозиметрия и защита", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Человек с дозиметром у источника: расстояние и экран": "abstract", "Шкала бытовых доз: от банана до лучевой болезни": "scale" },
    },
    I0: { value: 100, min: 20, max: 500, step: 10, label: "Активность кобальта-60, МБк", render: (get) => get("Дозиметрия и защита.scenario") === "abstract" },
    material: { value: "Свинец (μ = 0,67 /см)", options: Object.keys(MATERIALS), label: "Материал экрана", render: (get) => get("Дозиметрия и защита.scenario") === "abstract" },
    xShield: { value: 0, min: 0, max: 20, step: 0.5, label: "Толщина экрана, см", render: (get) => get("Дозиметрия и защита.scenario") === "abstract" },
  });
  const isScale = scenario === "scale";
  const mat = MATERIALS[material] ?? MATERIALS["Свинец (μ = 0,67 /см)"];
  const mu = mat.mu;
  const pass = Math.exp(-mu * xShield);
  const hvl = Math.log(2) / mu;

  const curveR = useMemo(() => {
    const pts: { r: number; free: number; shielded: number }[] = [];
    for (let i = 0; i <= 45; i++) {
      const r = 0.5 + (4.5 * i) / 45;
      pts.push({ r: Number(r.toFixed(2)), free: Number(doseRate(I0, r, 1).toFixed(2)), shielded: Number(doseRate(I0, r, pass).toFixed(2)) });
    }
    return pts;
  }, [I0, pass]);

  const blank = useMemo<LiveNumbers>(() => ({ t: 0, r: R_MIN, rate: doseRate(I0, R_MIN, pass) }), [I0, pass]);
  const [live, setLive] = useState<LiveNumbers>(blank);
  const [series, setSeries] = useState<SamplePoint[]>([]);
  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);
  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    setLive(blank);
    setSeries([]);
  }, [clock, blank]);
  const lastScenario = useRef(scenario);
  useEffect(() => {
    if (lastScenario.current === scenario) return;
    lastScenario.current = scenario;
    handleReset();
  }, [scenario, handleReset]);

  const reading = `${fmtRate(live.rate)} мкЗв/ч`;
  const caption = isScale ? (
    <>
      Дозы из жизни в «днях природного фона»: банан — около 20 минут фона, рентген зуба — сутки, перелёт Москва — Владивосток — 6 дней, КТ груди — почти 3 года. Опасны дозы в тысячи раз больше: 4 Зв,
      полученные сразу, без лечения смертельны примерно для половины людей. Столбики — в логарифмическом масштабе: каждая ступень выше — доза в 10 раз больше.
    </>
  ) : (
    <>
      Человек с дозиметром на груди подходит к капсуле кобальта-60 и отходит. Сейчас он в {live.r.toFixed(1).replace(".", ",")} м: дозиметр показывает <b>{reading}</b> — в{" "}
      {Math.round(live.rate / BACKGROUND).toLocaleString("ru-RU")} {razWord(Math.round(live.rate / BACKGROUND))} выше природного фона. Ближе вдвое — доза вчетверо больше.{" "}
      {xShield > 0 ? (
        <>
          Экран ({mat.short}, {xShield.toString().replace(".", ",")} см) пропускает {(pass * 100).toFixed(pass < 0.1 ? 1 : 0).replace(".", ",")} % квантов: каждые {hvl.toFixed(1).replace(".", ",")} см
          ослабляют излучение вдвое.
        </>
      ) : (
        <>Поставьте экран — свинец, бетон или воду.</>
      )}{" "}
      Годовую норму для населения (1 мЗв) здесь можно получить {fmtTime(1000 / live.rate)}.
    </>
  );
  const legend: LegendItem[] = isScale
    ? [
        { color: "#4ade80", label: "ничтожно малая доза", kind: "square" },
        { color: "#fbbf24", label: "как природный фон за год", kind: "square" },
        { color: "#f87171", label: "опасная доза", kind: "square" },
      ]
    : [
        { color: "#bef264", label: "гамма-кванты (невидимы, показаны условно)", kind: "dot" },
        { color: "#facc15", label: "дозиметр на груди", kind: "square" },
        { color: SHIELD_COLOR[mat.kind], label: `экран: ${mat.short}`, kind: "square" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isScale ? { position: [0, 2.5, 9.4] as [number, number, number], fov: 50 } : { position: [2.4, 2.5, 6.4] as [number, number, number], fov: 50 }}
          orbitTarget={isScale ? [0, 1.0, 0] : [2.2, 0.9, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={2}
          bloomThreshold={0.85}
        >
          {isScale ? (
            <SceneDoseScale />
          ) : (
            <SceneShield
              key={clock.resetNonce}
              activity={I0}
              mu={mu}
              xShield={xShield}
              kind={mat.kind}
              reading={reading}
              running={clock.running}
              speed={clock.speed}
              onSample={handleSample}
              onLive={setLive}
            />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={<TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />}
      numbers={
        isScale ? (
          <NumberReadouts
            items={DOSE_ITEMS.map((d) => ({
              label: `${d.name} (≈ ${d.uSv / BACKGROUND_PER_DAY < 1 ? `${Math.round((d.uSv / BACKGROUND_PER_DAY) * 24 * 60)} мин` : d.uSv / BACKGROUND_PER_DAY < 365 ? `${Math.round(d.uSv / BACKGROUND_PER_DAY)} сут` : `${Math.round(d.uSv / 2400)} лет`} фона)`,
              value: d.uSv >= 1000 ? (d.uSv / 1000).toLocaleString("ru-RU") : d.uSv.toLocaleString("ru-RU"),
              unit: d.uSv >= 1000 ? "мЗв" : "мкЗв",
              color: d.color,
            }))}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Расстояние до источника", value: live.r.toFixed(2), unit: "м" },
              { label: "Показание дозиметра", value: fmtRate(live.rate), unit: "мкЗв/ч" },
              { label: "Без экрана было бы", value: fmtRate(doseRate(I0, live.r, 1)), unit: "мкЗв/ч" },
              { label: "Экран пропускает", value: (pass * 100).toFixed(pass < 0.1 ? 2 : 1), unit: "%" },
              { label: "Слой половинного ослабления", value: hvl.toFixed(1), unit: "см" },
              { label: "1 мЗв (годовая норма) наберётся", value: fmtTime(1000 / live.rate) },
            ]}
          />
        )
      }
      graphs={
        isScale ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Шкала охватывает 7 порядков величины. Банан содержит немного радиоактивного калия-40; рентген зуба и перелёт (космические лучи на высоте 10 км) сравнимы с днями обычного фона; годовой
            природный фон (радон из грунта, космос, горные породы, калий в теле) каждый получает просто живя на Земле. Острые дозы в несколько зивертов, полученные за короткое время, вызывают лучевую
            болезнь — такие дозы получили пожарные и операторы в первые дни аварии в Чернобыле.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Мощность дозы от расстояния — закон обратных квадратов</p>
              <LiveChart
                data={curveR}
                xKey="r"
                xType="number"
                xLabel="r, м"
                series={[
                  { key: "free", color: "#f87171", label: "без экрана, мкЗв/ч" },
                  { key: "shielded", color: "#4ade80", label: "с экраном, мкЗв/ч" },
                ]}
              />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">Показания дозиметра во время прогулки</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "rate", color: "#facc15", label: "мкЗв/ч" }]} />
            </div>
          </div>
        )
      }
      note={
        isScale ? (
          <>
            Радиационная защита строится на трёх принципах — время, расстояние, экран: чем короче облучение, чем дальше источник и чем толще защита, тем меньше накопленная доза. Бытовые источники дают
            ничтожные дозы по сравнению с природным фоном, а он на много порядков меньше аварийных доз — это помогает оценивать реальный, а не воображаемый риск.
          </>
        ) : (
          <>
            От точечного источника мощность дозы падает как 1/r²: вдвое дальше — вчетверо меньше. Экран ослабляет поток по закону I = I₀·e^(−μx); слой половинного ослабления ln2/μ для гамма-квантов
            кобальта-60 (1,25 МэВ) — около 1 см свинца, 5 см бетона или 11 см воды. Мощность дозы капсулы 100 МБк на расстоянии 1 м — около 35 мкЗв/ч; природный фон — около 0,1 мкЗв/ч.
          </>
        )
      }
    />
  );
}
