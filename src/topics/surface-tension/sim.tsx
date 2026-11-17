import { useCallback, useRef, useState } from "react";
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
import { LabBench, RetortStand } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const G = 9.8;
const RISE_T = 2;
const VIS_SCALE = 6;

const LIQUIDS: Record<string, { sigma: number; rho: number; thetaDeg: number; color: string }> = {
  "Вода (стекло)": { sigma: 0.0728, rho: 1000, thetaDeg: 0, color: "#38bdf8" },
  "Этанол (стекло)": { sigma: 0.022, rho: 789, thetaDeg: 0, color: "#a78bfa" },
  "Ртуть (стекло)": { sigma: 0.487, rho: 13600, thetaDeg: 140, color: "#c0c0c8" },
};

interface SamplePoint {
  t: number;
  h: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  h: number;
}

interface SceneContentProps {
  hTarget: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function SceneContent({ hTarget, color, running, speed, onSample, onLive }: SceneContentProps & { color: string }) {
  const columnRef = useRef<THREE.Mesh>(null!);
  const meniscusRef = useRef<THREE.Mesh>(null!);
  const hVis = hTarget * VIS_SCALE;

  const handleFrame = useCallback(
    (t: number) => {
      const frac = Math.min(t / RISE_T, 1);
      const h = hVis * frac;
      if (columnRef.current) {
        const height = Math.max(Math.abs(h), 0.001);
        columnRef.current.scale.y = height;
        columnRef.current.position.y = h >= 0 ? height / 2 : -height / 2;
      }
      if (meniscusRef.current) meniscusRef.current.position.y = h;
    },
    [hVis],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const frac = Math.min(t / RISE_T, 1);
          onSample({ t, h: hTarget * frac });
          onLive({ t, h: hTarget * frac });
        }}
      />

      <LabBench position={[0, -1.5, 0]} length={6} depth={4} height={0.9} />
      {/* glass dish with the liquid */}
      <mesh position={[0, -0.32, 0]}>
        <cylinderGeometry args={[1.6, 1.55, 0.6, 48, 1, true]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.6, 0]}>
        <cylinderGeometry args={[1.55, 1.55, 0.03, 48]} />
        <meshStandardMaterial color="#e0f2fe" transparent opacity={0.3} />
      </mesh>
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <cylinderGeometry args={[1.56, 1.52, 0.56, 48]} />
        <meshStandardMaterial color={color} transparent opacity={color === "#c0c0c8" ? 0.92 : 0.45} metalness={color === "#c0c0c8" ? 0.95 : 0.1} roughness={0.15} depthWrite={false} />
      </mesh>
      <RetortStand position={[-1.25, -0.6, -0.9]} height={4.4} armLength={1.4} />
      <mesh position={[0, 3.77, -0.9]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.95, 8]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, 3.62, 0]}>
        <boxGeometry args={[0.36, 0.14, 0.14]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.4} />
      </mesh>
      <SceneLabel position={[1.2, 3.6, 0]}>капилляр в зажиме</SceneLabel>

      {/* glass tube */}
      <mesh position={[0, 1.65, 0]}>
        <cylinderGeometry args={[0.14, 0.14, 4.0, 24, 1, true]} />
        <meshStandardMaterial color="#8f8fa3" transparent opacity={0.2} side={THREE.DoubleSide} roughness={0.15} />
      </mesh>

      {/* liquid column inside tube */}
      <mesh ref={columnRef} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 1, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} transparent opacity={0.8} roughness={0.3} metalness={color === "#c0c0c8" ? 0.9 : 0} />
      </mesh>
      <mesh ref={meniscusRef}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} transparent opacity={0.85} metalness={color === "#c0c0c8" ? 0.9 : 0} />
      </mesh>
    </>
  );
}

const SIGMA_WATER = 0.0728;
const STRIDER_LEGS = 6;

interface StriderLive {
  t: number;
  y: number;
  sinking: boolean;
}

function SceneStrider({ massMg, running, speed, onLive, onFinished }: { massMg: number; running: boolean; speed: number; onLive: (n: StriderLive) => void; onFinished: () => void }) {
  const bodyRef = useRef<THREE.Group>(null!);
  const finishedRef = useRef(false);
  const weightN = (massMg / 1e6) * G; // mg -> kg -> N
  const legContactPerimeter = STRIDER_LEGS * 2 * Math.PI * 0.0005; // each leg dimple ~0.5mm radius
  const maxForce = SIGMA_WATER * legContactPerimeter;
  const sinking = weightN > maxForce;

  const yAt = useCallback(
    (t: number) => {
      if (!sinking) return 0.02 + 0.01 * Math.sin(t * 2);
      return Math.max(0.02 - 0.15 * t * t, -0.6);
    },
    [sinking],
  );

  const handleFrame = useCallback(
    (t: number) => {
      const y = yAt(t);
      if (bodyRef.current) bodyRef.current.position.y = y;
      if (sinking && y <= -0.6 && !finishedRef.current) {
        finishedRef.current = true;
        onFinished();
      }
    },
    [yAt, sinking, onFinished],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={20} onSample={(t) => onLive({ t, y: yAt(t), sinking })} />

      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[3.2, 64]} />
        <meshStandardMaterial color="#0e7490" transparent opacity={0.75} roughness={0.08} metalness={0.2} />
      </mesh>
      <mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 4.6, 48]} />
        <meshStandardMaterial color="#365314" roughness={0.95} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        const r = 3.0 + (i % 3) * 0.12;
        return (
          <mesh key={i} position={[Math.cos(a) * r, 0.45 + (i % 4) * 0.08, Math.sin(a) * r - 0.4]} rotation={[0.1 * Math.sin(i), 0, 0.08 * Math.cos(i)]}>
            <cylinderGeometry args={[0.012, 0.02, 0.95 + (i % 4) * 0.15, 6]} />
            <meshStandardMaterial color="#4d7c0f" roughness={0.8} />
          </mesh>
        );
      })}
      <mesh position={[1.4, -0.01, -1.1]} rotation={[-Math.PI / 2, 0, 0.6]}>
        <circleGeometry args={[0.45, 24, 0.4, Math.PI * 1.8]} />
        <meshStandardMaterial color="#15803d" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <SceneLabel position={[2.2, 0.1, 1.9]}>пруд: поверхность воды как упругая плёнка</SceneLabel>

      <group ref={bodyRef}>
        {/* abdomen, thorax, head */}
        <mesh castShadow position={[-0.12, 0.02, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.75, 1, 0.75]}>
          <capsuleGeometry args={[0.06, 0.32, 4, 10]} />
          <meshStandardMaterial color="#3f2a14" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[0.15, 0.03, 0]} scale={[1.3, 0.8, 1]}>
          <sphereGeometry args={[0.06, 14, 10]} />
          <meshStandardMaterial color="#4b3218" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[0.26, 0.04, 0]}>
          <sphereGeometry args={[0.04, 12, 10]} />
          <meshStandardMaterial color="#2a1b0c" roughness={0.5} />
        </mesh>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[0.29, 0.06, sd * 0.03]}>
            <sphereGeometry args={[0.013, 8, 6]} />
            <meshStandardMaterial color="#111" roughness={0.2} />
          </mesh>
        ))}
        {Array.from({ length: STRIDER_LEGS }, (_, i) => {
          const side = i % 2 === 0 ? 1 : -1;
          const pair = Math.floor(i / 2); // 0 = front (short), 1 = middle (long, rowing), 2 = hind
          const len = pair === 0 ? 0.22 : pair === 1 ? 0.62 : 0.5;
          const angle = pair === 0 ? 0.6 : pair === 1 ? 0.05 : -0.55;
          const hip = new THREE.Vector3(0.12 - pair * 0.08, 0.02, side * 0.04);
          const foot = new THREE.Vector3(hip.x + Math.cos(angle) * len * 0.75, -0.015, side * (0.06 + len * 0.7));
          const knee = hip.clone().lerp(foot, 0.4).add(new THREE.Vector3(0, 0.09, 0));
          return (
            <group key={i}>
              {[
                [hip, knee],
                [knee, foot],
              ].map(([a, b], j) => {
                const dir = b.clone().sub(a);
                const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
                return (
                  <mesh key={j} position={a.clone().add(b).multiplyScalar(0.5)} quaternion={q}>
                    <cylinderGeometry args={[0.006, 0.006, dir.length(), 5]} />
                    <meshStandardMaterial color="#2a1b0c" roughness={0.6} />
                  </mesh>
                );
              })}
              {/* the dimple the foot presses into the water surface */}
              {pair > 0 && !sinking && (
                <mesh position={[foot.x, -0.012, foot.z]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.02, 0.06, 20]} />
                  <meshStandardMaterial color="#e0f2fe" transparent opacity={0.6} side={THREE.DoubleSide} />
                </mesh>
              )}
            </group>
          );
        })}
        <SceneLabel position={[0, 0.35, 0]}>водомерка, m = {massMg.toFixed(0)} мг</SceneLabel>
      </group>
    </>
  );
}

export function SurfaceTensionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, liquid, r, massMg } = useControls("Поверхностное натяжение", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Капилляр: жидкость поднимается сама": "abstract", "Водомерка на воде": "strider" },
    },
    liquid: { value: "Вода (стекло)", options: Object.keys(LIQUIDS), label: "Жидкость", render: (get) => get("Поверхностное натяжение.scenario") === "abstract" },
    r: { value: 0.5, min: 0.1, max: 1.5, step: 0.05, label: "r трубки, мм", render: (get) => get("Поверхностное натяжение.scenario") === "abstract" },
    massMg: { value: 10, min: 2, max: 200, step: 2, label: "масса насекомого, мг", render: (get) => get("Поверхностное натяжение.scenario") === "strider" },
  });
  const strider = scenario === "strider";

  const { sigma, rho, thetaDeg } = LIQUIDS[liquid];
  const theta = (thetaDeg * Math.PI) / 180;
  const rMeters = r / 1000;
  const hTarget = (2 * sigma * Math.cos(theta)) / (rho * G * rMeters);
  const laplaceP = (2 * sigma * Math.cos(theta)) / rMeters;
  const hydrostaticP = rho * G * hTarget;

  const legPerimeter = STRIDER_LEGS * 2 * Math.PI * 0.0005;
  const maxForce = SIGMA_WATER * legPerimeter;
  const maxMassMg = (maxForce / G) * 1e6;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, h: 0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, h: 0 }]);
  const [striderLive, setStriderLive] = useState<StriderLive>({ t: 0, y: 0.02, sinking: false });
  const hMm = (hTarget * 1000).toFixed(1).replace(".", ",");
  const captionST = strider ? (
    massMg <= maxMassMg ? (
      <>
        <b>Водомерка держится на воде,</b> хотя тяжелее воды: под каждой лапкой поверхность прогибается, как батут, и сила поверхностного натяжения (до {(maxForce * 1000).toFixed(2).replace(".", ",")} мН)
        выталкивает её вверх. Вес насекомого — всего {((massMg / 1e6) * G * 1000).toFixed(2).replace(".", ",")} мН.
      </>
    ) : (
      <>
        <b>Слишком тяжело:</b> вес {((massMg / 1e6) * G * 1000).toFixed(2).replace(".", ",")} мН больше, чем может удержать плёнка воды (≈{(maxForce * 1000).toFixed(2).replace(".", ",")} мН), — насекомое
        проваливается. Предел ≈ {maxMassMg.toFixed(0)} мг.
      </>
    )
  ) : thetaDeg > 90 ? (
    <>
      <b>Ртуть не смачивает стекло,</b> поэтому в тонкой трубке она <b>опускается</b> ниже уровня в чашке на {hMm.replace("-", "")} мм, а её поверхность выпуклая. Чем тоньше трубка, тем сильнее эффект.
    </>
  ) : (
    <>
      Жидкость смачивает стекло и <b>сама поднимается</b> по тонкой трубке на h = 2σ/(ρgr) = {hMm} мм — так вода поднимается по стеблям растений и впитывается в салфетку. Чем тоньше трубка, тем
      выше подъём.
    </>
  );
  const legendST: LegendItem[] = strider ? [] : [{ color: LIQUIDS[liquid].color, label: liquid, kind: "square" }];

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);
  const handleFinished = useCallback(() => clock.pause(), [clock]);

  const resetState = useCallback(() => {
    setLive({ t: 0, h: 0 });
    setSeries([{ t: 0, h: 0 }]);
    setStriderLive({ t: 0, y: 0.02, sinking: false });
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  return (
    <SimShell
      scene={
        <SceneCanvas key={scenario} camera={strider ? { position: [1.6, 1.4, 2.6], fov: 45 } : { position: [3.2, 2.8, 5.6] as [number, number, number], fov: 50 }} orbitTarget={[0, strider ? 0.1 : 1.2, 0]} simplified={isMobile} maxDistance={16} minDistance={1} bloomThreshold={0.6} fogRange={[12, 40]}>
          {strider ? (
            <SceneStrider key={clock.resetNonce} massMg={massMg} running={clock.running} speed={clock.speed} onLive={setStriderLive} onFinished={handleFinished} />
          ) : (
            <SceneContent key={clock.resetNonce} hTarget={hTarget} color={LIQUIDS[liquid].color} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legendST}
      caption={captionST}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        strider ? (
          <NumberReadouts
            items={[
              { label: "Время t", value: striderLive.t.toFixed(2), unit: "с" },
              { label: "Вес насекомого", value: ((massMg / 1e6) * G * 1000).toFixed(3), unit: "мН" },
              { label: "Сила натяжения (макс.)", value: (maxForce * 1000).toFixed(3), unit: "мН" },
              { label: "Макс. масса без утопления", value: maxMassMg.toFixed(1), unit: "мг" },
              { label: "Статус", value: striderLive.sinking ? "тонет!" : "держится на поверхности", color: striderLive.sinking ? "#f87171" : "#4ade80" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Время t", value: live.t.toFixed(2), unit: "с" },
              { label: "h(t) — уровень в трубке", value: (live.h * 1000).toFixed(2), unit: "мм" },
              { label: "h = 2σcosθ/(ρgr)", value: (hTarget * 1000).toFixed(2), unit: "мм" },
              { label: "Лапласово ΔP=2σcosθ/r", value: laplaceP.toFixed(1), unit: "Па" },
              { label: "Гидростатич. ρgh", value: hydrostaticP.toFixed(1), unit: "Па" },
            ]}
          />
        )
      }
      graphs={
        strider ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Реальная водомерка весит около 10 мг и распределяет вес по 6 несмачиваемым лапкам — суммарная сила
            поверхностного натяжения на границе контакта с запасом превышает её вес. Увеличьте массу выше{" "}
            {maxMassMg.toFixed(0)} мг — плёнка не выдержит, и «насекомое» провалится под воду.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Подъём/опускание уровня жидкости в капилляре</p>
            <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "h", color: "#4ade80", label: "h, м" }]} />
          </div>
        )
      }
      note={
        strider ? (
          <>
            Поверхность воды ведёт себя как упругая плёнка: лапки насекомого создают вмятины, не разрывая её,
            пока вертикальная составляющая силы поверхностного натяжения вдоль контура контакта (F=σ·L)
            превышает вес. Тот же эффект в невесомости заставляет каплю жидкости стянуться в идеальную сферу —
            без силы тяжести, расплющивающей её о поверхность, побеждает исключительно поверхностное
            натяжение, минимизирующее площадь поверхности при данном объёме.
          </>
        ) : (
          <>
            Поверхностное натяжение создаёт избыточное лапласово давление под искривлённым мениском
            ΔP=2σcosθ/r, уравновешенное столбом жидкости ρgh — отсюда высота капиллярного поднятия
            h=2σcosθ/(ρgr). Для смачивающей жидкости (вода, θ&lt;90°) уровень поднимается; для несмачивающей
            (ртуть в стекле, θ&gt;90°) — опускается (капиллярная депрессия).
          </>
        )
      }
    />
  );
}
