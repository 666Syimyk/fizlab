import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { FieldArrow } from "@/components/sim/FieldArrow";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { Phone } from "@/components/sim/props/electric";
import { LabBench } from "@/components/sim/props/environment";
import { badgeTexture } from "@/components/sim/props/textures";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const EPS0 = 8.854e-12;
const PERIOD = 5;
const X_LEFT = -2;
const X_RIGHT = 2;
const SLAB_HALF = 0.5;
const PROBE_Y = 0.9;
const BADGE_GRID: [number, number][] = [-0.6, 0, 0.6].flatMap((z) => [0, 0.45, 0.9].map((y) => [y, z] as [number, number]));

/** "+"/"−" badges standing on a vertical face at x (charges sitting on a surface). */
function ChargeBadges({ x, sign, scale = 0.16, opacity = 1 }: { x: number; sign: 1 | -1; scale?: number; opacity?: number }) {
  const tex = useMemo(() => badgeTexture(sign > 0 ? "+" : "−", sign > 0 ? "#dc2626" : "#2563eb"), [sign]);
  return (
    <>
      {BADGE_GRID.map(([y, z]) => (
        <sprite key={`${y}${z}`} position={[x, y, z]} scale={scale} renderOrder={3}>
          <spriteMaterial map={tex} transparent opacity={opacity} depthTest={false} />
        </sprite>
      ))}
    </>
  );
}

type SlabType = "conductor" | "dielectric";

function fieldAt(x: number, E0: number, slab: SlabType, epsR: number) {
  if (x > -SLAB_HALF && x < SLAB_HALF) return slab === "conductor" ? 0 : E0 / epsR;
  return E0;
}

interface SamplePoint {
  t: number;
  E: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  x: number;
  E: number;
}

interface SceneContentProps {
  E0: number;
  slab: SlabType;
  epsR: number;
  phone: boolean;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

function StaticArrows({ E0, slab, epsR }: { E0: number; slab: SlabType; epsR: number }) {
  const arrows = useMemo(() => {
    const list: { origin: [number, number, number]; vector: [number, number, number] }[] = [];
    for (let i = 0; i < 9; i++) {
      const x = X_LEFT + ((X_RIGHT - X_LEFT) * i) / 8;
      const E = fieldAt(x, E0, slab, epsR);
      const scale = Math.min((E / E0) * 0.8, 0.8);
      for (const z of [-1, 0, 1]) {
        list.push({ origin: [x, 0.4, z], vector: [scale, 0, 0] });
      }
    }
    return list;
  }, [E0, slab, epsR]);

  return (
    <>
      {arrows.map((a, i) => (
        <FieldArrow key={i} origin={a.origin} vector={a.vector} color="#5eead4" opacity={0.8} />
      ))}
    </>
  );
}

function SceneContent({ E0, slab, epsR, phone, running, speed, onSample, onLive }: SceneContentProps) {
  const probeRef = useRef<THREE.Mesh>(null!);

  const handleFrame = useCallback(
    (t: number) => {
      const frac = (t % PERIOD) / PERIOD;
      const x = X_LEFT + (X_RIGHT - X_LEFT) * frac;
      if (probeRef.current) probeRef.current.position.x = x;
    },
    [],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={25}
        onSample={(t) => {
          const frac = (t % PERIOD) / PERIOD;
          const x = X_LEFT + (X_RIGHT - X_LEFT) * frac;
          const E = fieldAt(x, E0, slab, epsR);
          onSample({ t, E });
          onLive({ t, x, E });
        }}
      />

      <LabBench position={[0, -1.5, 0]} length={8} depth={3.4} height={0.9} />
      {/* two metal plates on insulating stands; their edges are painted by charge sign */}
      {[
        { x: X_LEFT - 0.3, color: "#dc2626", text: phone ? "пластина + (внешнее поле)" : "пластина +" },
        { x: X_RIGHT + 0.3, color: "#2563eb", text: phone ? "пластина − (внешнее поле)" : "пластина −" },
      ].map((pl) => (
        <group key={pl.x} position={[pl.x, 0.4, 0]}>
          <mesh>
            <boxGeometry args={[0.1, 2, 2.4]} />
            <meshStandardMaterial color="#d4d4d8" metalness={0.55} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.02, 0]}>
            <boxGeometry args={[0.11, 0.05, 2.4]} />
            <meshStandardMaterial color={pl.color} emissive={pl.color} emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, -1.25, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.5, 10]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.5} />
          </mesh>
          <SceneLabel position={[0, 1.45, 0]}>{pl.text}</SceneLabel>
        </group>
      ))}
      <ChargeBadges x={X_LEFT - 0.3 + 0.08} sign={1} />
      <ChargeBadges x={X_RIGHT + 0.3 - 0.08} sign={-1} />

      {/* the inserted body: aluminium block, glass slab, or a thin metal box around a phone */}
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[SLAB_HALF * 2, 1.8, 2]} />
        <meshStandardMaterial
          color={phone ? "#cbd5e1" : slab === "conductor" ? "#a1a1aa" : "#bae6fd"}
          transparent
          opacity={phone ? 0.28 : slab === "conductor" ? 0.6 : 0.32}
          metalness={phone || slab === "conductor" ? 0.85 : 0.1}
          roughness={slab === "conductor" ? 0.3 : 0.05}
          depthWrite={false}
        />
        <SceneLabel position={[0, 1.3, 0]}>{phone ? "металлическая коробка" : slab === "conductor" ? "кусок металла (проводник)" : "стекло (диэлектрик)"}</SceneLabel>
      </mesh>
      <lineSegments position={[0, 0.4, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(SLAB_HALF * 2, 1.8, 2)]} />
        <lineBasicMaterial color={slab === "conductor" ? "#e5e7eb" : "#e0f2fe"} />
      </lineSegments>
      {phone && <Phone position={[0, 0.4, 0]} signal={false} />}
      {phone && <SceneLabel position={[0, -0.25, 1.1]}>телефон внутри: «Нет сети»</SceneLabel>}
      {/* charges induced on the faces: free electrons in metal, bound (polarisation) charges in glass */}
      <ChargeBadges x={-SLAB_HALF - 0.04} sign={-1} scale={slab === "conductor" ? 0.16 : 0.12} opacity={slab === "conductor" ? 1 : 0.35 + 0.65 * (1 - 1 / epsR)} />
      <ChargeBadges x={SLAB_HALF + 0.04} sign={1} scale={slab === "conductor" ? 0.16 : 0.12} opacity={slab === "conductor" ? 1 : 0.35 + 0.65 * (1 - 1 / epsR)} />

      <StaticArrows E0={E0} slab={slab} epsR={epsR} />

      <mesh ref={probeRef} position={[X_LEFT, PROBE_Y, 0.5]} castShadow>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} />
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.8, 8]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <SceneLabel position={[0, 1.0, 0]}>датчик поля</SceneLabel>
      </mesh>
    </>
  );
}

export function ConductorsDielectricsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, sigmaMicro, slab, epsR } = useControls("Проводники и диэлектрики в поле", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Металл или стекло между пластинами": "abstract", "Телефон в металлической коробке": "phone" },
    },
    sigmaMicro: { value: 2, min: 0.5, max: 6, step: 0.25, label: "σ пластин, мкКл/м²" },
    slab: {
      value: "dielectric",
      options: { Диэлектрик: "dielectric", Проводник: "conductor" },
      label: "Материал вставки",
      render: (get) => get("Проводники и диэлектрики в поле.scenario") === "abstract",
    },
    epsR: {
      value: 4,
      min: 1.5,
      max: 10,
      step: 0.5,
      label: "εr (для диэлектрика)",
      render: (get) => get("Проводники и диэлектрики в поле.scenario") === "abstract" && get("Проводники и диэлектрики в поле.slab") === "dielectric",
    },
  });
  const phone = scenario === "phone";
  const effSlab: SlabType = phone ? "conductor" : (slab as SlabType);

  const E0 = (sigmaMicro * 1e-6) / EPS0;
  const boundCharge = effSlab === "dielectric" ? sigmaMicro * (1 - 1 / epsR) : sigmaMicro;

  const [live, setLive] = useState<LiveNumbers>({ t: 0, x: X_LEFT, E: E0 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, E: E0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 400 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, x: X_LEFT, E: E0 });
    setSeries([{ t: 0, E: E0 }]);
  }, [E0]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const inside = live.x > -SLAB_HALF && live.x < SLAB_HALF;
  const eNow = (inside ? (effSlab === "conductor" ? 0 : E0 / epsR) : E0) / 1000;
  const caption = phone ? (
    <>
      Телефон лежит в <b>металлической коробке</b>. Внешнее поле сдвигает свободные электроны в стенках: на них появляются заряды «−» и «+», и их поле <b>гасит внешнее внутри коробки</b> — E = 0,
      сигнал не доходит. Так работают клетка Фарадея, экран кабеля, стенки микроволновки и лифта.
    </>
  ) : effSlab === "conductor" ? (
    <>
      В металле свободные электроны сбегаются к левой грани («−»), справа остаётся «+». Их поле точно компенсирует внешнее, поэтому <b>внутри металла E = 0</b>. Датчик сейчас{" "}
      {inside ? "внутри металла: 0 кВ/м" : `снаружи: ${eNow.toFixed(0)} кВ/м`}.
    </>
  ) : (
    <>
      Стекло не проводит ток, но его молекулы <b>поляризуются</b>: на гранях появляются слабые связанные заряды, и поле внутри ослабевает в εr = {epsR.toString().replace(".", ",")} раз. Датчик
      сейчас {inside ? "в стекле" : "в воздухе"}: E = {eNow.toFixed(0)} кВ/м.
    </>
  );
  const legend: LegendItem[] = [
    { color: "#5eead4", label: "поле E" },
    { color: "#dc2626", label: "заряды +", kind: "dot" },
    { color: "#2563eb", label: "заряды −", kind: "dot" },
    { color: "#fbbf24", label: "датчик поля", kind: "dot" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas camera={{ position: [0.6, 2.8, 6.8], fov: 50 }} orbitTarget={[0, 0.4, 0]} simplified={isMobile} maxDistance={18} minDistance={3} bloomThreshold={0.6} fogRange={[14, 40]}>
          <SceneContent key={clock.resetNonce} E0={E0} slab={effSlab} epsR={epsR} phone={phone} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        <NumberReadouts
          items={[
            { label: phone ? "E₀ снаружи корпуса" : "E₀ = σ/ε₀ (вне вставки)", value: (E0 / 1000).toFixed(1), unit: "кВ/м" },
            { label: phone ? "E внутри корпуса" : "E внутри вставки", value: (((live.x > -SLAB_HALF && live.x < SLAB_HALF ? (effSlab === "conductor" ? 0 : E0 / epsR) : E0)) / 1000).toFixed(1), unit: "кВ/м" },
            { label: "Пробник: x(t)", value: live.x.toFixed(2), unit: "м" },
            { label: "Наведённый заряд поверхности", value: boundCharge.toFixed(2), unit: "мкКл/м²" },
          ]}
        />
      }
      graphs={
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <p className="mb-1 px-1 text-xs font-medium text-muted-2">E(t), измеренное движущимся пробником</p>
          <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "E", color: "#5eead4", label: "E, В/м" }]} />
        </div>
      }
      note={
        phone ? (
          <>
            Металлический корпус телефона (и обёрнутая вокруг него сетка антенны) работает как клетка Фарадея:
            свободные электроны в металле мгновенно перераспределяются и полностью гасят электрическое поле
            внутри — переменное электромагнитное поле сигнала не проникает внутрь, поэтому в лифте или
            плотно упакованной металлической сумке телефон часто теряет связь.
          </>
        ) : (
          <>
            Проводник в поле полностью экранирует его внутри (E=0) за счёт наведённых зарядов на поверхности,
            равных по модулю заряду пластин. Диэлектрик лишь ослабляет поле в εr раз (E=E₀/εr) за счёт частичной
            поляризации молекул — связанный заряд меньше свободного. Жёлтый пробник сканирует поле слева направо.
          </>
        )
      }
    />
  );
}
