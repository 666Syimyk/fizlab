import { useCallback, useMemo, useRef, useState } from "react";
import { useControls } from "leva";
import * as THREE from "three";
import { SceneCanvas } from "@/components/scene/SceneCanvas";
import { PhysicsTicker } from "@/components/sim/PhysicsTicker";
import { VectorArrow, type VectorArrowHandle } from "@/components/sim/VectorArrow";
import { TransportControls } from "@/components/sim/TransportControls";
import { SimShell } from "@/components/sim/SimShell";
import { NumberReadouts } from "@/components/sim/NumberReadouts";
import { LiveChart } from "@/components/sim/LiveChart";
import { SceneLabel } from "@/components/sim/SceneLabel";
import type { LegendItem } from "@/components/sim/SceneOverlay";
import { LightBulb } from "@/components/sim/props/electric";
import { LabBench } from "@/components/sim/props/environment";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const E0 = 1.0;
const VIS_PERIOD = 1.4;
const BEAM_Y = 1.1;

interface SamplePoint {
  t: number;
  theta: number;
  I: number;
  [key: string]: number;
}
interface LiveNumbers {
  t: number;
  thetaDeg: number;
  I: number;
}

function monitorPicture() {
  return canvasTexture("monitor-picture", 512, 320, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#38bdf8");
    g.addColorStop(1, "#e0f2fe");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.28, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.quadraticCurveTo(w * 0.3, h * 0.55, w * 0.6, h * 0.82);
    ctx.quadraticCurveTo(w * 0.8, h * 0.68, w, h * 0.78);
    ctx.lineTo(w, h);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText("ФизЛаб", 30, 64);
  });
}

/** Round polarising filter in a frame; the bright line marks its transmission axis. */
function Polaroid({ tint = "#334155", opacity = 0.35 }: { tint?: string; opacity?: number }) {
  return (
    <group>
      <mesh>
        <circleGeometry args={[0.55, 40]} />
        <meshStandardMaterial color={tint} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.56, 0.035, 10, 48]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[0.02, 1.0, 0.005]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
    </group>
  );
}

interface SceneContentProps {
  rotPeriod: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/* ---------- a monitor seen through rotating polarising sunglasses ---------- */
function SceneContent({ rotPeriod, running, speed, onSample, onLive }: SceneContentProps) {
  const arrow1 = useRef<VectorArrowHandle>(null);
  const arrow2 = useRef<VectorArrowHandle>(null);
  const glasses = useRef<THREE.Group>(null!);
  const lensMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const picture = useMemo(() => monitorPicture(), []);

  const handleFrame = useCallback(
    (t: number) => {
      const theta = (2 * Math.PI * t) / rotPeriod;
      const osc = Math.sin((2 * Math.PI * t) / VIS_PERIOD);
      // the LCD sends out light polarised vertically
      arrow1.current?.set([0, BEAM_Y, -0.55], [0, E0 * osc, 0]);
      // after the glasses: only the projection on their axis is left, amplitude ∝ cosθ
      const amp2 = E0 * Math.cos(theta) * osc;
      arrow2.current?.set([0, BEAM_Y, 1.6], [-Math.sin(theta) * amp2, Math.cos(theta) * amp2, 0]);
      if (glasses.current) glasses.current.rotation.z = theta;
      const pass = Math.cos(theta) ** 2;
      lensMats.current.forEach((m) => m && (m.opacity = 0.18 + 0.8 * (1 - pass)));
    },
    [rotPeriod],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const theta = (2 * Math.PI * t) / rotPeriod;
          const I = Math.pow(Math.cos(theta), 2);
          onSample({ t, theta: (theta * 180) / Math.PI, I });
          onLive({ t, thetaDeg: ((theta * 180) / Math.PI) % 360, I });
        }}
      />
      <LabBench position={[0, -0.9, 0]} length={3.6} depth={4.6} height={0.9} />

      {/* LCD monitor: its light is already polarised */}
      <group position={[0, BEAM_Y, -1.6]}>
        <mesh castShadow>
          <boxGeometry args={[2.2, 1.45, 0.1]} />
          <meshStandardMaterial color="#111827" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.02, 0.051]}>
          <planeGeometry args={[2.05, 1.28]} />
          <meshStandardMaterial map={picture} emissive="#ffffff" emissiveMap={picture} emissiveIntensity={0.8} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.95, -0.1]}>
          <boxGeometry args={[0.12, 0.5, 0.1]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, -BEAM_Y + 0.03, -0.1]}>
          <boxGeometry args={[0.7, 0.06, 0.45]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <SceneLabel position={[0, 1.0, 0]}>экран монитора: свет уже поляризован</SceneLabel>
      </group>

      {/* polarising sunglasses rotating about the line of sight */}
      <group ref={glasses} position={[0, BEAM_Y, 0.7]}>
        {[-0.38, 0.38].map((x, i) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh>
              <circleGeometry args={[0.32, 36]} />
              <meshStandardMaterial
                ref={(m) => {
                  lensMats.current[i] = m;
                }}
                color="#0f172a"
                transparent
                opacity={0.2}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <mesh>
              <torusGeometry args={[0.33, 0.03, 8, 40]} />
              <meshStandardMaterial color="#111827" roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.01]}>
              <boxGeometry args={[0.015, 0.6, 0.004]} />
              <meshBasicMaterial color="#e2e8f0" transparent opacity={0.6} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.08, 0]}>
          <torusGeometry args={[0.08, 0.025, 8, 16, Math.PI]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.72, 0.05, 0.4]} rotation={[0, 0, 0]}>
            <boxGeometry args={[0.04, 0.04, 0.8]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        ))}
      </group>
      <SceneLabel position={[0, BEAM_Y + 0.7, 0.7]}>поляризационные очки (поворачиваются)</SceneLabel>

      <VectorArrow ref={arrow1} color="#a78bfa" />
      <VectorArrow ref={arrow2} color="#fbbf24" />
    </>
  );
}

/* ---------- lamp and three polarising filters ---------- */
interface ThreePolLive {
  t: number;
  I: number;
}

function SceneThreePolarizers({ theta2Deg, running, speed, onLive }: { theta2Deg: number; running: boolean; speed: number; onLive: (n: ThreePolLive) => void }) {
  const arrow1 = useRef<VectorArrowHandle>(null);
  const arrow2 = useRef<VectorArrowHandle>(null);
  const arrow3 = useRef<VectorArrowHandle>(null);
  const spotMat = useRef<THREE.MeshBasicMaterial>(null!);
  const theta2 = (theta2Deg * Math.PI) / 180;
  const I1 = 0.5;
  const I2 = I1 * Math.cos(theta2) ** 2;
  const I3 = I2 * Math.sin(theta2) ** 2;

  const handleFrame = useCallback(
    (t: number) => {
      const osc = Math.sin((2 * Math.PI * t) / VIS_PERIOD);
      const a1 = Math.sqrt(I1) * E0 * 1.4 * osc;
      arrow1.current?.set([0, BEAM_Y, -0.9], [0, a1, 0]);
      const a2 = Math.sqrt(I2) * E0 * 1.4 * osc;
      arrow2.current?.set([0, BEAM_Y, 0.6], [-Math.sin(theta2) * a2, Math.cos(theta2) * a2, 0]);
      const a3 = Math.sqrt(I3) * E0 * 1.4 * osc;
      arrow3.current?.set([0, BEAM_Y, 2.1], [a3, 0, 0]);
      if (spotMat.current) spotMat.current.opacity = Math.min(1, I3 * 8);
    },
    [theta2, I2, I3],
  );

  const filters: { z: number; angle: number; label: string }[] = [
    { z: -1.5, angle: 0, label: "фильтр 1, 0°" },
    { z: 0, angle: theta2, label: `фильтр 2, ${theta2Deg.toFixed(0)}°` },
    { z: 1.5, angle: Math.PI / 2, label: "фильтр 3, 90°" },
  ];

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} sampleHz={5} onSample={(t) => onLive({ t, I: I3 })} />
      <LabBench position={[0, -0.9, 0.1]} length={3} depth={6.6} height={0.9} />

      <group position={[0, 0, -2.7]}>
        <mesh position={[0, (BEAM_Y - 0.3) / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, BEAM_Y - 0.3, 10]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <LightBulb position={[0, BEAM_Y - 0.55, 0]} brightness={1} />
        <SceneLabel position={[0, BEAM_Y + 0.6, 0]}>лампа: свет не поляризован</SceneLabel>
      </group>

      {filters.map((f) => (
        <group key={f.z} position={[0, 0, f.z]}>
          <mesh position={[0, (BEAM_Y - 0.55) / 2, 0]}>
            <cylinderGeometry args={[0.03, 0.03, BEAM_Y - 0.55, 10]} />
            <meshStandardMaterial color="#52525b" />
          </mesh>
          <group position={[0, BEAM_Y, 0]} rotation={[0, 0, f.angle]}>
            <Polaroid />
          </group>
          <SceneLabel position={[0, BEAM_Y + 0.8, 0]}>{f.label}</SceneLabel>
        </group>
      ))}

      <VectorArrow ref={arrow1} color="#a78bfa" />
      <VectorArrow ref={arrow2} color="#fbbf24" />
      <VectorArrow ref={arrow3} color="#f87171" />

      {/* white screen with the light spot */}
      <group position={[0, BEAM_Y, 2.9]}>
        <mesh>
          <boxGeometry args={[1.4, 1.4, 0.04]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, -0.03]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[0.4, 32]} />
          <meshBasicMaterial ref={spotMat} color="#fef9c3" transparent opacity={0} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 0.95, 0]}>экран</SceneLabel>
      </group>
    </>
  );
}

export function PolarizationSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);
  const { scenario, rotPeriod, theta2Deg } = useControls("Поляризация света", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Монитор и поляризационные очки (закон Малюса)": "abstract", "Парадокс трёх поляризаторов": "three" },
    },
    rotPeriod: { value: 8, min: 3, max: 16, step: 1, label: "Период вращения очков, с", render: (get) => get("Поляризация света.scenario") === "abstract" },
    theta2Deg: { value: 45, min: 0, max: 90, step: 1, label: "Угол среднего поляризатора, °", render: (get) => get("Поляризация света.scenario") === "three" },
  });
  const isThree = scenario === "three";
  const [threeLive, setThreeLive] = useState<ThreePolLive>({ t: 0, I: 0 });
  const theta2Rad = (theta2Deg * Math.PI) / 180;

  const curve = useMemo(() => {
    const pts: { deg: number; I: number }[] = [];
    for (let i = 0; i <= 72; i++) {
      const deg = i * 5;
      const I = Math.pow(Math.cos((deg * Math.PI) / 180), 2);
      pts.push({ deg, I: Number(I.toFixed(3)) });
    }
    return pts;
  }, []);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, thetaDeg: 0, I: 1 });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, theta: 0, I: 1 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, thetaDeg: 0, I: 1 });
    setSeries([{ t: 0, theta: 0, I: 1 }]);
  }, []);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const fmt = (v: number, d = 0) => v.toFixed(d).replace(".", ",");
  const caption = isThree ? (
    <>
      Фильтры 1 и 3 стоят под 90° — вдвоём они не пропустили бы ни лучика. Но средний фильтр под {theta2Deg}° поворачивает поляризацию «в два шага», и на экран доходит I = I₁·cos²θ·sin²θ ={" "}
      {fmt(threeLive.I * 100, 1)} % света. Лишний фильтр <b>добавил</b> свет!
    </>
  ) : (
    <>
      Монитор светит поляризованным светом — колебания E вертикальные (фиолетовая стрелка). Очки пропускают только колебания вдоль своей оси. Сейчас угол {fmt(live.thetaDeg)}°, проходит{" "}
      <b>cos²θ = {fmt(live.I * 100)} %</b> света: при 90° экран через очки становится чёрным. Попробуйте с телефоном и солнечными очками!
    </>
  );
  const legend: LegendItem[] = isThree
    ? [
        { color: "#a78bfa", label: "E после фильтра 1" },
        { color: "#fbbf24", label: "E после фильтра 2" },
        { color: "#f87171", label: "E после фильтра 3" },
      ]
    : [
        { color: "#a78bfa", label: "E от монитора" },
        { color: "#fbbf24", label: "E после очков" },
        { color: "#e2e8f0", label: "ось пропускания", kind: "line" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isThree ? { position: [3.9, 2.6, 0.9] as [number, number, number], fov: 50 } : { position: [2.6, 2.0, 3.6] as [number, number, number], fov: 50 }}
          orbitTarget={isThree ? [0, BEAM_Y, 0.1] : [0, BEAM_Y, -0.2]}
          simplified={isMobile}
          maxDistance={16}
          minDistance={2.5}
          bloomThreshold={0.75}
          fogRange={[14, 40]}
        >
          {isThree ? (
            <SceneThreePolarizers key={clock.resetNonce} theta2Deg={theta2Deg} running={clock.running} speed={clock.speed} onLive={setThreeLive} />
          ) : (
            <SceneContent key={clock.resetNonce} rotPeriod={rotPeriod} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isThree ? (
          <NumberReadouts
            items={[
              { label: "I₁ после поляризатора 1", value: (0.5).toFixed(3) },
              { label: "I₂ после поляризатора 2", value: (0.5 * Math.cos(theta2Rad) ** 2).toFixed(3) },
              { label: "I₃ после поляризатора 3 (0°⊥90°)", value: threeLive.I.toFixed(4), color: "#4ade80" },
              { label: "Без среднего поляризатора I было бы", value: "0 (скрещены под 90°)" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "Угол θ между осями", value: live.thetaDeg.toFixed(1), unit: "°" },
              { label: "I/I₀ = cos²θ (закон Малюса)", value: live.I.toFixed(3) },
            ]}
          />
        )
      }
      graphs={
        isThree ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Первый и третий поляризаторы скрещены под 90° — по отдельности они гасят свет полностью. Но
            вставленный между ними второй, повёрнутый на угол θ (двигайте ползунок), пропускает
            I₃=I₁·cos²θ·sin²θ — максимум при θ=45°. Свет «появляется» из ничего, потому что каждый
            поляризатор проецирует вектор E на свою ось, а не просто блокирует «неправильно
            ориентированный» свет — при 45° он успевает довернуть поляризацию до нужного направления
            двумя маленькими шагами вместо одного невозможного скачка на 90°.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">I(θ) = I₀cos²θ</p>
              <LiveChart data={curve} xKey="deg" xType="number" xLabel="θ, °" series={[{ key: "I", color: "#fbbf24", label: "I/I₀" }]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">I(t) при вращении очков</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "I", color: "#fbbf24", label: "I/I₀" }]} />
            </div>
          </div>
        )
      }
      note={
        isThree ? (
          <>
            Это классический «парадокс» поляризации: интуиция подсказывает, что дополнительный фильтр
            может только убавить света, но здесь он его добавляет. Эффект — прямое следствие закона Малюса,
            применённого дважды подряд, и лежит в основе некоторых ЖК-технологий и оптических затворов.
          </>
        ) : (
          <>
            ЖК-экран монитора или телефона сам выпускает линейно поляризованный свет — вектор E колеблется
            вдоль одной оси (это первый поляризатор). Поляризационные очки — второй: пропускаемая амплитуда
            ∝cosθ, интенсивность I=I₀cos²θ — закон Малюса. При θ=90° экран через очки кажется чёрным.
            Такие очки водители носят, чтобы гасить блики от мокрой дороги: отражённый свет тоже поляризован.
          </>
        )
      }
    />
  );
}
