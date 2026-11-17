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
import { LabBench } from "@/components/sim/props/environment";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const BEND_ANGLES_DEG = [75, 68, 60];
const FIBER_POINTS = [
  new THREE.Vector3(-2.6, 0.6, 0),
  new THREE.Vector3(-1.2, 0.9, 0.3),
  new THREE.Vector3(0, 0.4, -0.2),
  new THREE.Vector3(1.2, 0.7, 0.4),
  new THREE.Vector3(2.6, 0.3, 0),
];

const PERIOD = 8;
const THETA_MAX_DEG = 85;
/** radius of the optical disc; the beams are drawn inside it */
const DISC_R = 2.3;
const DISC_Y = 2.6;

interface SamplePoint {
  t: number;
  theta1: number;
  theta2: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  theta1Deg: number;
  theta2Deg: number;
  tir: boolean;
  critDeg: number | null;
}

function computeRefraction(theta1: number, n1: number, n2: number) {
  const sinT2 = (n1 / n2) * Math.sin(theta1);
  if (Math.abs(sinT2) > 1) return { theta2: null, tir: true };
  return { theta2: Math.asin(sinT2), tir: false };
}

/** Fresnel reflectance for unpolarised light (1 at total internal reflection). */
function reflectance(theta1: number, theta2: number | null, n1: number, n2: number) {
  if (theta2 === null) return 1;
  const c1 = Math.cos(theta1);
  const c2 = Math.cos(theta2);
  const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2);
  const rp = (n1 * c2 - n2 * c1) / (n1 * c2 + n2 * c1);
  return (rs * rs + rp * rp) / 2;
}

function materialFor(n: number) {
  if (n < 1.15) return { name: "воздух", color: "#e0f2fe", opacity: 0.04 };
  if (n < 1.4) return { name: "вода", color: "#38bdf8", opacity: 0.3 };
  if (n < 1.7) return { name: "стекло", color: "#a5f3fc", opacity: 0.28 };
  if (n < 2.15) return { name: "тяжёлое стекло", color: "#c7d2fe", opacity: 0.32 };
  return { name: "алмаз", color: "#f1f5f9", opacity: 0.4 };
}

/** Degree scale of the school "optical disc" (оптическая шайба): 0° along the normal, both up and down. */
function discTexture() {
  return canvasTexture("optical-disc", 1024, 1024, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 8;
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#334155";
    ctx.fillStyle = "#334155";
    ctx.lineWidth = 3;
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180;
      const long = d % 10 === 0;
      const r1 = R - (long ? 46 : 26);
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * R * 0.985, cy - Math.cos(a) * R * 0.985);
      ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.stroke();
      if (d % 30 === 0) {
        const shown = d <= 90 ? d : d <= 180 ? 180 - d : d <= 270 ? d - 180 : 360 - d;
        ctx.font = "bold 34px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(shown), cx + Math.sin(a) * (R - 82), cy - Math.cos(a) * (R - 82));
      }
    }
    // the normal and the boundary
    ctx.setLineDash([16, 12]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R + 50);
    ctx.lineTo(cx, cy + R - 50);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - R + 50, cy);
    ctx.lineTo(cx + R - 50, cy);
    ctx.stroke();
  });
}

interface SceneContentProps {
  n1: number;
  n2: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Thin glowing beam from a to b (imperative). */
function useBeam() {
  const ref = useRef<THREE.Mesh>(null!);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  const set = useCallback(
    (ax: number, ay: number, bx: number, by: number, strength: number) => {
      const m = ref.current;
      if (!m) return;
      tmp.a.set(ax, ay, 0.02);
      tmp.b.set(bx, by, 0.02);
      tmp.d.subVectors(tmp.b, tmp.a);
      const len = tmp.d.length();
      m.visible = strength > 0.01 && len > 1e-3;
      m.position.addVectors(tmp.a, tmp.b).multiplyScalar(0.5);
      m.quaternion.copy(tmp.q.setFromUnitVectors(UP, tmp.d.normalize()));
      m.scale.set(1, len, 1);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, 0.15 + strength);
    },
    [tmp],
  );
  return { ref, set };
}

function SceneContent({ n1, n2, running, speed, onSample, onLive }: SceneContentProps) {
  const laser = useRef<THREE.Group>(null!);
  const incident = useBeam();
  const reflected = useBeam();
  const refracted = useBeam();
  const disc = useMemo(() => discTexture(), []);
  const m1 = materialFor(n1);
  const m2 = materialFor(n2);

  const thetaAt = useCallback((t: number) => {
    const frac = (t % PERIOD) / PERIOD;
    const deg = 5 + THETA_MAX_DEG * Math.abs(Math.sin(Math.PI * frac));
    return (deg * Math.PI) / 180;
  }, []);

  const handleFrame = useCallback(
    (t: number) => {
      const theta1 = thetaAt(t);
      const { theta2 } = computeRefraction(theta1, n1, n2);
      const R = reflectance(theta1, theta2, n1, n2);
      const r = DISC_R - 0.25;
      // the laser rides along the rim of the disc and always aims at its centre
      if (laser.current) {
        laser.current.position.set(-Math.sin(theta1) * (r + 0.35), DISC_Y + Math.cos(theta1) * (r + 0.35), 0.05);
        laser.current.rotation.z = theta1;
      }
      incident.set(-Math.sin(theta1) * r, DISC_Y + Math.cos(theta1) * r, 0, DISC_Y, 1);
      reflected.set(0, DISC_Y, Math.sin(theta1) * r, DISC_Y + Math.cos(theta1) * r, R);
      if (theta2 === null) refracted.set(0, DISC_Y, 0, DISC_Y, 0);
      else refracted.set(0, DISC_Y, Math.sin(theta2) * r, DISC_Y - Math.cos(theta2) * r, 1 - R);
    },
    [n1, n2, thetaAt, incident, reflected, refracted],
  );

  const beamMat = (color: string) => <meshBasicMaterial color={color} transparent opacity={1} toneMapped={false} depthWrite={false} />;

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const theta1 = thetaAt(t);
          const { theta2, tir } = computeRefraction(theta1, n1, n2);
          const critDeg = n1 > n2 ? (Math.asin(n2 / n1) * 180) / Math.PI : null;
          onSample({ t, theta1: (theta1 * 180) / Math.PI, theta2: theta2 !== null ? (theta2 * 180) / Math.PI : 0 });
          onLive({ t, theta1Deg: (theta1 * 180) / Math.PI, theta2Deg: theta2 !== null ? (theta2 * 180) / Math.PI : 0, tir, critDeg });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={6} depth={2.4} height={0.9} />
      {/* the optical disc on a stand */}
      <mesh position={[0, DISC_Y, -0.06]}>
        <circleGeometry args={[DISC_R + 0.1, 96]} />
        <meshStandardMaterial map={disc} roughness={0.8} />
      </mesh>
      <mesh position={[0, DISC_Y, -0.09]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[DISC_R + 0.12, DISC_R + 0.12, 0.04, 96]} />
        <meshStandardMaterial color="#334155" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, (DISC_Y - DISC_R) / 2, -0.12]}>
        <boxGeometry args={[0.2, DISC_Y - DISC_R, 0.12]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
      </mesh>

      {/* upper medium: a half-cylinder (the beam enters it along a radius and does not bend there); lower medium: a block */}
      <mesh position={[0, DISC_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[DISC_R - 0.2, DISC_R - 0.2, 0.3, 64, 1, false, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color={m1.color} transparent opacity={m1.opacity} roughness={0.05} metalness={0.1} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, DISC_Y - (DISC_R - 0.2) / 2, 0]}>
        <boxGeometry args={[2 * (DISC_R - 0.2), DISC_R - 0.2, 0.3]} />
        <meshStandardMaterial color={m2.color} transparent opacity={m2.opacity} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <SceneLabel position={[-1.25, DISC_Y + 0.55, 0.3]}>{`${m1.name}, n₁ = ${n1.toFixed(2).replace(".", ",")}`}</SceneLabel>
      <SceneLabel position={[-1.25, DISC_Y - 0.55, 0.3]}>{`${m2.name}, n₂ = ${n2.toFixed(2).replace(".", ",")}`}</SceneLabel>

      {/* laser pointer */}
      <group ref={laser}>
        <mesh>
          <cylinderGeometry args={[0.07, 0.07, 0.6, 18]} />
          <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.31, 0]}>
          <cylinderGeometry args={[0.04, 0.07, 0.05, 18]} />
          <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.07, 0.1, 0]}>
          <boxGeometry args={[0.03, 0.08, 0.05]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      </group>
      <SceneLabel position={[-2.6, DISC_Y + 2.0, 0]}>лазерная указка ездит по краю диска</SceneLabel>

      <mesh ref={incident.ref}>
        <cylinderGeometry args={[0.025, 0.025, 1, 8]} />
        {beamMat("#ef4444")}
      </mesh>
      <mesh ref={reflected.ref}>
        <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
        {beamMat("#fb923c")}
      </mesh>
      <mesh ref={refracted.ref}>
        <cylinderGeometry args={[0.025, 0.025, 1, 8]} />
        {beamMat("#f43f5e")}
      </mesh>
      <mesh position={[0, DISC_Y, 0.02]}>
        <sphereGeometry args={[0.05, 14, 12]} />
        <meshBasicMaterial color="#fecaca" toneMapped={false} />
      </mesh>
    </>
  );
}

/* ---------- optical fibre ---------- */
interface FiberLive {
  guided: boolean;
  critDeg: number;
  failBend: number;
}

function SceneFiber({ nCore, nClad, running, speed, onLive }: { nCore: number; nClad: number; running: boolean; speed: number; onLive: (n: FiberLive) => void }) {
  const photonRef = useRef<THREE.Group>(null!);
  const screenMat = useRef<THREE.MeshStandardMaterial>(null!);
  const leakMat = useRef<THREE.MeshBasicMaterial>(null!);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(FIBER_POINTS), []);
  const critDeg = nCore > nClad ? (Math.asin(nClad / nCore) * 180) / Math.PI : 90;
  const failIdx = BEND_ANGLES_DEG.findIndex((a) => a <= critDeg);
  const guided = failIdx === -1;
  const failFrac = failIdx >= 0 ? (failIdx + 1) / (BEND_ANGLES_DEG.length + 1) : 1;
  const TRAVERSE_T = 4;
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), tan: new THREE.Vector3(), side: new THREE.Vector3() }), []);
  const leakPoint = useMemo(() => curve.getPointAt(Math.min(failFrac, 0.999)), [curve, failFrac]);
  const leakDir = useMemo(() => curve.getTangentAt(Math.min(failFrac, 0.999)), [curve, failFrac]);

  useEffect(() => {
    onLive({ guided, critDeg, failBend: failIdx });
  }, [guided, critDeg, failIdx, onLive]);

  const handleFrame = useCallback(
    (t: number) => {
      const raw = (t % TRAVERSE_T) / TRAVERSE_T;
      const g = photonRef.current;
      if (!g) return;
      if (guided || raw < failFrac) {
        const u = Math.min(raw, 0.999);
        curve.getPointAt(u, tmp.p);
        curve.getTangentAt(u, tmp.tan);
        tmp.side.set(-tmp.tan.y, tmp.tan.x, 0).normalize();
        // zig-zag between the walls of the core = repeated total internal reflections
        const zig = (2 / Math.PI) * Math.asin(Math.sin(u * Math.PI * 22)) * 0.05;
        g.position.copy(tmp.p).addScaledVector(tmp.side, zig);
        g.visible = true;
      } else {
        // the light escapes through the cladding and flies off straight
        const s = (raw - failFrac) * TRAVERSE_T * 1.5;
        g.position.copy(leakPoint).addScaledVector(leakDir, s);
        g.visible = s < 2.5;
      }
      const atEnd = guided && raw > 0.93;
      if (screenMat.current) screenMat.current.emissiveIntensity = atEnd ? 2.5 : 0.15;
      if (leakMat.current) leakMat.current.opacity = !guided && raw > failFrac && raw < failFrac + 0.2 ? 0.8 : 0.15;
    },
    [curve, guided, failFrac, tmp, leakPoint, leakDir],
  );

  const start = FIBER_POINTS[0];
  const end = FIBER_POINTS[FIBER_POINTS.length - 1];

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -1.6, 0]} length={7.4} depth={2.8} height={0.9} />
      {/* cladding and core of the fibre */}
      <mesh>
        <tubeGeometry args={[curve, 96, 0.16, 16, false]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, 96, 0.075, 12, false]} />
        <meshStandardMaterial color="#5eead4" transparent opacity={0.35} emissive="#5eead4" emissiveIntensity={0.25} depthWrite={false} />
      </mesh>
      <SceneLabel position={[0, 1.35, 0]}>оптоволокно: сердцевина и оболочка</SceneLabel>

      {/* laser at the input, receiver screen at the output */}
      <group position={[start.x - 0.45, start.y, start.z]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.12, 0.12, 0.7, 20]} />
          <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
        </mesh>
        <SceneLabel position={[0, 0.4, 0]}>лазер</SceneLabel>
      </group>
      <group position={[end.x + 0.3, end.y, end.z]}>
        <mesh>
          <boxGeometry args={[0.1, 0.6, 0.6]} />
          <meshStandardMaterial ref={screenMat} color="#e5e7eb" emissive="#ef4444" emissiveIntensity={0.15} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 0.55, 0]}>{guided ? "приёмник: сигнал дошёл" : "приёмник: сигнала нет"}</SceneLabel>
      </group>

      <group ref={photonRef}>
        <mesh>
          <sphereGeometry args={[0.06, 14, 12]} />
          <meshBasicMaterial color="#fca5a5" toneMapped={false} />
        </mesh>
        <pointLight color="#ef4444" intensity={1.5} distance={1.2} />
      </group>

      {!guided && (
        <>
          <mesh position={leakPoint}>
            <sphereGeometry args={[0.22, 16, 12]} />
            <meshBasicMaterial ref={leakMat} color="#ef4444" transparent opacity={0.2} toneMapped={false} depthWrite={false} />
          </mesh>
          <SceneLabel position={[leakPoint.x, leakPoint.y + 0.45, leakPoint.z]}>свет вытекает — угол меньше критического</SceneLabel>
        </>
      )}
    </>
  );
}

export function GeometricOpticsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, n1, n2, nCore, nClad } = useControls("Геометрическая оптика", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Оптическая шайба: луч лазера на границе сред": "abstract", "Оптоволокно (интернет)": "fiber" },
    },
    n1: { value: 1.5, min: 1, max: 2.4, step: 0.05, label: "n₁ (верхняя среда)", render: (get) => get("Геометрическая оптика.scenario") === "abstract" },
    n2: { value: 1, min: 1, max: 2.4, step: 0.05, label: "n₂ (нижняя среда)", render: (get) => get("Геометрическая оптика.scenario") === "abstract" },
    nCore: { value: 1.48, min: 1.3, max: 1.6, step: 0.01, label: "n сердцевины", render: (get) => get("Геометрическая оптика.scenario") === "fiber" },
    nClad: { value: 1.46, min: 1.2, max: 1.6, step: 0.01, label: "n оболочки", render: (get) => get("Геометрическая оптика.scenario") === "fiber" },
  });
  const isFiber = scenario === "fiber";
  const [fiberLive, setFiberLive] = useState<FiberLive>({ guided: true, critDeg: 0, failBend: -1 });

  const curve = useMemo(() => {
    const pts: { theta1: number; theta2: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const deg = (89 * i) / 60;
      const theta1 = (deg * Math.PI) / 180;
      const { theta2 } = computeRefraction(theta1, n1, n2);
      if (theta2 !== null) pts.push({ theta1: Number(deg.toFixed(1)), theta2: Number(((theta2 * 180) / Math.PI).toFixed(1)) });
    }
    return pts;
  }, [n1, n2]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, theta1Deg: 0, theta2Deg: 0, tir: false, critDeg: null });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, theta1: 0, theta2: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, theta1Deg: 0, theta2Deg: 0, tir: false, critDeg: null });
    setSeries([{ t: 0, theta1: 0, theta2: 0 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const fmt = (v: number, d = 0) => v.toFixed(d).replace(".", ",");
  const m1 = materialFor(n1);
  const m2 = materialFor(n2);
  const caption = isFiber ? (
    fiberLive.guided ? (
      <>
        Лазер светит в стеклянную нить. Свет падает на стенку сердцевины под большим углом, <b>полностью отражается</b> и бежит зигзагом внутри, даже на изгибах, — до приёмника на другом конце.
        Так по оптоволокну идёт интернет.
      </>
    ) : (
      <>
        Оболочка слишком «похожа» на сердцевину: критический угол {fmt(fiberLive.critDeg)}° стал больше угла падения на изгибе {fiberLive.failBend + 1}, отражение уже не полное — свет{" "}
        <b>вытекает</b>, сигнал до приёмника не доходит.
      </>
    )
  ) : live.tir ? (
    <>
      Угол падения {fmt(live.theta1Deg)}° больше критического ({fmt(live.critDeg ?? 0)}°): луч <b>не выходит</b> из среды «{m1.name}» — он целиком отражается назад. Это полное внутреннее отражение:
      благодаря ему блестят алмазы и работает оптоволокно.
    </>
  ) : (
    <>
      Лазерный луч падает на границу «{m1.name} — {m2.name}» под углом {fmt(live.theta1Deg)}° к нормали (пунктир). Часть света отражается (оранжевый луч, угол тот же), остальное проходит и{" "}
      <b>преломляется</b>: θ₂ = {fmt(live.theta2Deg)}°, по закону n₁·sin θ₁ = n₂·sin θ₂.
    </>
  );
  const legend: LegendItem[] = isFiber
    ? [{ color: "#ef4444", label: "импульс света", kind: "dot" }]
    : [
        { color: "#ef4444", label: "падающий луч", kind: "line" },
        { color: "#fb923c", label: "отражённый", kind: "line" },
        { color: "#f43f5e", label: "преломлённый", kind: "line" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isFiber ? { position: [0, 2.2, 6.4] as [number, number, number], fov: 50 } : { position: [0.5, 3.1, 7.6] as [number, number, number], fov: 50 }}
          orbitTarget={isFiber ? [0, 0.4, 0] : [0, DISC_Y - 0.2, 0]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={3}
          bloomThreshold={0.6}
          fogRange={[14, 40]}
        >
          {isFiber ? (
            <SceneFiber key={clock.resetNonce} nCore={nCore} nClad={nClad} running={clock.running} speed={clock.speed} onLive={setFiberLive} />
          ) : (
            <SceneContent key={clock.resetNonce} n1={n1} n2={n2} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isFiber ? (
          <NumberReadouts
            items={[
              { label: "Критический угол", value: fiberLive.critDeg.toFixed(1), unit: "°" },
              { label: "Углы на изгибах волокна", value: BEND_ANGLES_DEG.join("° / ") + "°" },
              { label: "Свет удерживается (полн. внутр. отраж.)", value: fiberLive.guided ? "да" : "нет, теряется на изгибе " + (fiberLive.failBend + 1) },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Угол падения θ₁", value: live.theta1Deg.toFixed(1), unit: "°" },
              { label: "Угол преломления θ₂", value: live.tir ? "—" : live.theta2Deg.toFixed(1), unit: "°" },
              { label: "Полное внутр. отражение", value: live.tir ? "да" : "нет" },
              { label: "Критический угол", value: live.critDeg !== null ? live.critDeg.toFixed(1) : "н/д", unit: "°" },
            ]}
          />
        )
      }
      graphs={
        isFiber ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Оптоволоконный интернет работает благодаря полному внутреннему отражению: сердцевина волокна
            имеет чуть больший показатель преломления, чем оболочка (n_core&gt;n_clad), поэтому свет,
            падающий на границу под углом больше критического θ_кр=arcsin(n_clad/n_core), отражается
            обратно внутрь и остаётся «запертым» в волокне даже на изгибах — сигнал проходит десятки
            километров почти без потерь.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">θ₂(θ₁) — закон Снеллиуса n₁sinθ₁=n₂sinθ₂</p>
              <LiveChart data={curve} xKey="theta1" xType="number" xLabel="θ₁, °" series={[{ key: "theta2", color: "#4ade80", label: "θ₂, °" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">θ₁(t) и θ₂(t) при развёртке угла падения</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "theta1", color: "#fbbf24", label: "θ₁, °" }, { key: "theta2", color: "#4ade80", label: "θ₂, °" }]} />
            </div>
          </div>
        )
      }
      note={
        isFiber ? (
          <>
            Если увеличить n оболочки так, что критический угол превысит реальный угол падения на одном
            из изгибов волокна, полное внутреннее отражение там срывается — часть света «протекает» наружу
            через оболочку, и сигнал слабеет. Именно поэтому оптоволокно изготавливают с точно
            контролируемой разницей показателей преломления сердцевины и оболочки.
          </>
        ) : (
          <>
            Оптическая шайба — школьный прибор: диск со шкалой углов и стеклянный полуцилиндр. Луч входит в
            полуцилиндр по радиусу и на круглой стороне не преломляется, а на плоской — да. Красный луч —
            падающий, оранжевый — отражённый (угол отражения = углу падения, яркость по формулам Френеля),
            малиновый — преломлённый по закону Снеллиуса n₁sinθ₁=n₂sinθ₂. При n₁&gt;n₂ и угле больше
            критического (sinθ_кр=n₂/n₁) преломлённый луч исчезает — полное внутреннее отражение.
          </>
        )
      }
    />
  );
}
