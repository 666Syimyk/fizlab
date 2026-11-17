import { useCallback, useMemo, useRef, useState } from "react";
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
import { LightBulb } from "@/components/sim/props/electric";
import { Ground, Tree } from "@/components/sim/props/environment";
import { Sun } from "@/components/sim/props/space";
import { wavelengthToColor } from "@/components/sim/props/shared";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const BANDS = [
  { name: "Радиоволны", max: 1e-1, color: "#f87171" },
  { name: "Микроволны", max: 1e-3, color: "#fb923c" },
  { name: "Инфракрасное", max: 7.5e-7, color: "#fbbf24" },
  { name: "Видимый свет", max: 3.8e-7, color: "#4ade80" },
  { name: "Ультрафиолет", max: 1e-8, color: "#60a5fa" },
  { name: "Рентген", max: 1e-11, color: "#818cf8" },
  { name: "Гамма-излучение", max: 0, color: "#c084fc" },
];

function bandFor(lambda: number) {
  for (const b of BANDS) if (lambda > b.max) return b;
  return BANDS[BANDS.length - 1];
}

const C_LIGHT = 3e8;
const N_POINTS = 26;
const X_MIN = -3.3;
const X_MAX = 3.3;
const VIS_PERIOD = 3;
const VIS_AMP = 1.0;
/** height of the wave axis above the ground */
const AXIS_Y = 2.2;

interface SnapshotPoint {
  x: number;
  Ey: number;
  Bz: number;
  [key: string]: number;
}

/** Lattice radio mast standing on y = 0. */
function RadioMast({ height = 1.4 }: { height?: number }) {
  const legs = [
    [0.22, 0.22],
    [-0.22, 0.22],
    [0, -0.25],
  ];
  return (
    <group>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x * 0.5, height / 2, z * 0.5]} rotation={[z * 0.1, 0, -x * 0.1]}>
          <cylinderGeometry args={[0.02, 0.03, height, 6]} />
          <meshStandardMaterial color="#dc2626" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[0, (i + 0.5) * (height / 5), 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.09 - i * 0.008, 0.11 - i * 0.008, 3]} />
          <meshStandardMaterial color={i % 2 ? "#f8fafc" : "#dc2626"} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

interface SceneContentProps {
  lambda: number;
  running: boolean;
  speed: number;
  tint?: string;
  showRadio: boolean;
  onSample: (pts: SnapshotPoint[]) => void;
}

function SceneContent({ lambda, running, speed, tint, showRadio, onSample }: SceneContentProps) {
  const meshERef = useRef<THREE.InstancedMesh>(null!);
  const meshBRef = useRef<THREE.InstancedMesh>(null!);
  const txTop = useRef<THREE.MeshStandardMaterial>(null!);
  const txBottom = useRef<THREE.MeshStandardMaterial>(null!);
  const rxDots = useRef<THREE.Group>(null!);
  const rxGlow = useRef<THREE.MeshStandardMaterial>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const k = (2 * Math.PI) / lambda;
  const wVis = (2 * Math.PI) / VIS_PERIOD;

  const handleFrame = useCallback(
    (t: number) => {
      const meshE = meshERef.current;
      const meshB = meshBRef.current;
      if (!meshE || !meshB) return;
      for (let i = 0; i < N_POINTS; i++) {
        const x = X_MIN + ((X_MAX - X_MIN) * i) / (N_POINTS - 1);
        const phase = k * x - wVis * t;
        const Ey = VIS_AMP * Math.sin(phase);
        const Bz = VIS_AMP * Math.sin(phase);

        dummy.position.set(x, AXIS_Y + Ey / 2, 0);
        dummy.scale.set(1, Math.max(Math.abs(Ey), 0.001), 1);
        dummy.updateMatrix();
        meshE.setMatrixAt(i, dummy.matrix);

        dummy.position.set(x, AXIS_Y, Bz / 2);
        dummy.scale.set(1, 1, Math.max(Math.abs(Bz), 0.001));
        dummy.updateMatrix();
        meshB.setMatrixAt(i, dummy.matrix);
      }
      meshE.instanceMatrix.needsUpdate = true;
      meshB.instanceMatrix.needsUpdate = true;
      // the charges in the transmitting dipole swing up and down and launch the wave
      const src = Math.sin(k * X_MIN - wVis * t);
      if (txTop.current) txTop.current.emissive.set(src > 0 ? "#dc2626" : "#2563eb");
      if (txBottom.current) txBottom.current.emissive.set(src > 0 ? "#2563eb" : "#dc2626");
      if (txTop.current) txTop.current.emissiveIntensity = 0.3 + Math.abs(src) * 1.2;
      if (txBottom.current) txBottom.current.emissiveIntensity = 0.3 + Math.abs(src) * 1.2;
      // the wave arriving at the receiver pushes its electrons along the rod
      const rx = Math.sin(k * X_MAX - wVis * t);
      if (rxDots.current) rxDots.current.position.y = -rx * 0.28;
      if (rxGlow.current) rxGlow.current.emissiveIntensity = 0.2 + Math.abs(rx) * 1.4;
    },
    [k, wVis, dummy],
  );

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={12}
        onSample={(t) => {
          const pts: SnapshotPoint[] = [];
          for (let i = 0; i <= 30; i++) {
            const x = X_MIN + ((X_MAX - X_MIN) * i) / 30;
            const phase = k * x - wVis * t;
            pts.push({ x: Number(x.toFixed(2)), Ey: Number(Math.sin(phase).toFixed(3)), Bz: Number(Math.sin(phase).toFixed(3)) });
          }
          onSample(pts);
        }}
      />

      {/* direction of travel */}
      <mesh position={[0, AXIS_Y, 0]}>
        <boxGeometry args={[X_MAX - X_MIN + 0.4, 0.015, 0.015]} />
        <meshStandardMaterial color="#a1a1aa" />
      </mesh>

      <instancedMesh ref={meshERef} args={[undefined, undefined, N_POINTS]} frustumCulled={false}>
        <boxGeometry args={[0.05, 1, 0.05]} />
        <meshStandardMaterial color={tint ?? "#f87171"} emissive={tint ?? "#f87171"} emissiveIntensity={0.7} />
      </instancedMesh>
      <SceneLabel position={[X_MIN + 0.6, AXIS_Y + 1.25, 0]}>E — электрическое поле (вверх-вниз)</SceneLabel>
      <instancedMesh ref={meshBRef} args={[undefined, undefined, N_POINTS]} frustumCulled={false}>
        <boxGeometry args={[0.05, 0.05, 1]} />
        <meshStandardMaterial color={tint ? "#e5e7eb" : "#38bdf8"} emissive={tint ? "#e5e7eb" : "#38bdf8"} emissiveIntensity={0.5} />
      </instancedMesh>
      <SceneLabel position={[X_MIN + 0.9, AXIS_Y - 0.2, 1.15]}>B — магнитное поле (вперёд-назад)</SceneLabel>

      {showRadio && (
        <>
          {/* transmitter: a mast with a vertical dipole antenna on top */}
          <group position={[X_MIN - 0.7, 0, 0]}>
            <RadioMast height={AXIS_Y - 0.7} />
            <mesh position={[0, AXIS_Y + 0.35, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.65, 10]} />
              <meshStandardMaterial ref={txTop} color="#d4d4d8" metalness={0.8} roughness={0.3} emissive="#dc2626" emissiveIntensity={0.3} />
            </mesh>
            <mesh position={[0, AXIS_Y - 0.35, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.65, 10]} />
              <meshStandardMaterial ref={txBottom} color="#d4d4d8" metalness={0.8} roughness={0.3} emissive="#2563eb" emissiveIntensity={0.3} />
            </mesh>
            <SceneLabel position={[0, AXIS_Y + 1.0, 0]}>передатчик: заряды бегают вверх-вниз</SceneLabel>
          </group>

          {/* receiver: a house with an antenna rod */}
          <group position={[X_MAX + 0.8, 0, 0]}>
            <mesh position={[0, 0.55, 0]} castShadow>
              <boxGeometry args={[1.1, 1.1, 1.1]} />
              <meshStandardMaterial color="#fde68a" roughness={0.8} />
            </mesh>
            <mesh position={[0, 1.35, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
              <coneGeometry args={[0.95, 0.6, 4]} />
              <meshStandardMaterial color="#b91c1c" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.5, 0.56]}>
              <planeGeometry args={[0.36, 0.36]} />
              <meshStandardMaterial color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={0.3} />
            </mesh>
            <mesh position={[-0.1, AXIS_Y, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 1.25, 10]} />
              <meshStandardMaterial ref={rxGlow} color="#d4d4d8" metalness={0.8} roughness={0.3} emissive="#fbbf24" emissiveIntensity={0.2} />
            </mesh>
            <group ref={rxDots} position={[-0.1, AXIS_Y, 0]}>
              {[-0.4, -0.2, 0, 0.2, 0.4].map((y) => (
                <mesh key={y} position={[0, y, 0.05]}>
                  <sphereGeometry args={[0.04, 10, 8]} />
                  <meshStandardMaterial color="#7dd3fc" emissive="#7dd3fc" emissiveIntensity={1.5} toneMapped={false} />
                </mesh>
              ))}
            </group>
            <SceneLabel position={[0, AXIS_Y + 0.95, 0]}>приёмник: волна качает электроны в антенне</SceneLabel>
          </group>
          <Tree position={[-6.5, 0, -4.5]} height={3} seed={2} />
          <Tree position={[6.8, 0, -5]} height={3.6} conifer seed={5} />
          <Ground kind="grass" from={-10} to={10} width={14} tile={4} tileZ={4} />
        </>
      )}
    </>
  );
}

/* ---------- objects that emit each band of the spectrum ---------- */
/** position (0..1) of a wavelength on the ruler: long radio waves on the left, gamma rays on the right */
const LOG_MAX = 3;
const LOG_SPAN = 15;
const rulerPos = (logLambda: number) => (LOG_MAX - logLambda) / LOG_SPAN;
const BAND_LABELS: { name: string; log: number }[] = [
  { name: "радио", log: 1 },
  { name: "СВЧ", log: -2 },
  { name: "ИК", log: -4.6 },
  { name: "свет", log: -6.27 },
  { name: "УФ", log: -7.3 },
  { name: "рентген", log: -9.5 },
  { name: "гамма", log: -11.5 },
];

function spectrumStrip() {
  return canvasTexture("em-spectrum-strip-v2", 1024, 64, (ctx, w, h) => {
    for (let x = 0; x < w; x++) {
      const logL = LOG_MAX - (x / w) * LOG_SPAN;
      const lambda = Math.pow(10, logL);
      const b = bandFor(lambda);
      ctx.fillStyle = b.name === "Видимый свет" ? wavelengthToColor(lambda * 1e9) : b.color;
      ctx.fillRect(x, 0, 1, h);
    }
  });
}

function BandObject({ band, lambda }: { band: string; lambda: number }) {
  switch (band) {
    case "Радиоволны":
      return (
        <group>
          <RadioMast height={2.2} />
          <SceneLabel position={[0, 2.7, 0]}>радиовышка, телефон, Wi-Fi</SceneLabel>
        </group>
      );
    case "Микроволны":
      return (
        <group position={[0, 0.9, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.0, 0.6, 0.7]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.5} />
          </mesh>
          <mesh position={[-0.12, 0, 0.351]}>
            <planeGeometry args={[0.62, 0.44]} />
            <meshStandardMaterial color="#111827" emissive="#fbbf24" emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0.36, 0, 0.351]}>
            <planeGeometry args={[0.18, 0.44]} />
            <meshStandardMaterial color="#374151" />
          </mesh>
          <mesh position={[0, -0.55, 0]}>
            <boxGeometry args={[1.2, 0.5, 0.9]} />
            <meshStandardMaterial color="#8b5a2b" roughness={0.7} />
          </mesh>
          <SceneLabel position={[0, 0.65, 0]}>микроволновка</SceneLabel>
        </group>
      );
    case "Инфракрасное":
      return (
        <group position={[0, 1.3, 0]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.16, 0.7, 0.1]} />
            <meshStandardMaterial color="#111827" roughness={0.5} />
          </mesh>
          <mesh position={[0.36, 0, 0]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={0.8} />
          </mesh>
          <SceneLabel position={[0, 0.45, 0]}>пульт от телевизора, тёплые предметы</SceneLabel>
        </group>
      );
    case "Видимый свет":
      return (
        <group position={[0, 0.9, 0]}>
          <LightBulb brightness={1} color={wavelengthToColor(lambda * 1e9)} />
          <SceneLabel position={[0, 1.0, 0]}>лампа, Солнце — то, что видит глаз</SceneLabel>
        </group>
      );
    case "Ультрафиолет":
      return (
        <group position={[0, 1.8, 0]}>
          <Sun radius={0.45} />
          <SceneLabel position={[0, 0.85, 0]}>Солнце: от ультрафиолета загорают</SceneLabel>
        </group>
      );
    case "Рентген":
      return (
        <group position={[0, 1.3, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.18, 0.18, 0.8, 20]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.45} />
          </mesh>
          <mesh position={[0, -0.32, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.18, 0.3, 20]} />
            <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
          </mesh>
          <SceneLabel position={[0, 0.5, 0]}>рентгеновская трубка: снимки костей</SceneLabel>
        </group>
      );
    default:
      return (
        <group position={[0, 1.0, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.28, 0.28, 0.5, 24]} />
            <meshStandardMaterial color="#facc15" roughness={0.5} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, 0.252, 0]} rotation={[-Math.PI / 2, 0, (i * 2 * Math.PI) / 3]}>
              <circleGeometry args={[0.22, 16, 0.2, Math.PI / 3]} />
              <meshStandardMaterial color="#111827" side={THREE.DoubleSide} />
            </mesh>
          ))}
          <SceneLabel position={[0, 0.6, 0]}>радиоактивный источник</SceneLabel>
        </group>
      );
  }
}

export function MaxwellEquationsSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, lambda, E0, logLambda } = useControls("Уравнения Максвелла: волна", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Радиоволна: от вышки к дому": "abstract", "Шкала ЭМ-спектра": "spectrum" },
    },
    lambda: { value: 3, min: 1, max: 6, step: 0.25, label: "λ, м (длина волны)", render: (get) => get("Уравнения Максвелла: волна.scenario") === "abstract" },
    E0: { value: 100, min: 10, max: 500, step: 10, label: "E₀, В/м (амплитуда поля)" },
    logLambda: { value: -6.5, min: -12, max: 3, step: 0.1, label: "lg(λ/м) — по всему спектру", render: (get) => get("Уравнения Максвелла: волна.scenario") === "spectrum" },
  });
  const isSpectrum = scenario === "spectrum";
  const realLambda = isSpectrum ? Math.pow(10, logLambda) : lambda;
  const band = bandFor(realLambda);
  const visLambda = isSpectrum ? 3 : lambda;
  const visibleTint = band.name === "Видимый свет" ? wavelengthToColor(realLambda * 1e9) : band.color;
  const strip = useMemo(() => spectrumStrip(), []);

  const f = C_LIGHT / realLambda;
  const B0 = E0 / C_LIGHT;

  const [snapshot, setSnapshot] = useState<SnapshotPoint[]>([]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const caption = isSpectrum ? (
    <>
      Это та же самая волна из E и B, меняется только длина волны: сейчас <b>{band.name.toLowerCase()}</b> (λ ={" "}
      {realLambda < 1e-6 ? `${fmt(realLambda * 1e9, 2)} нм` : realLambda < 1e-2 ? `${fmt(realLambda * 1e6, 1)} мкм` : `${fmt(realLambda, 2)} м`}). Чем короче волна, тем больше энергия каждой порции
      (фотона): радиоволны безопасны, ультрафиолет обжигает кожу, рентген проходит сквозь тело.
    </>
  ) : (
    <>
      В антенне вышки заряды бегают вверх-вниз. Меняющееся электрическое поле E (красное) рождает магнитное B (синее), а оно — снова электрическое: так волна <b>сама себя поддерживает</b> и
      летит к дому со скоростью света. В антенне дома она раскачивает электроны — это и есть принятый сигнал. Частота f = c/λ = {fmt(f / 1e6, 0)} МГц (анимация сильно замедлена).
    </>
  );
  const legend: LegendItem[] = [
    { color: isSpectrum ? visibleTint : "#f87171", label: "электрическое поле E", kind: "line" },
    { color: isSpectrum ? "#e5e7eb" : "#38bdf8", label: "магнитное поле B", kind: "line" },
  ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={{ position: [0.8, 4.0, 11.2] as [number, number, number], fov: 50 }}
          orbitTarget={[0, AXIS_Y - 0.4, 0]}
          simplified={isMobile}
          maxDistance={20}
          minDistance={3}
          bloomThreshold={0.65}
          fogRange={[18, 50]}
        >
          <SceneContent key={clock.resetNonce} lambda={visLambda} running={clock.running} speed={clock.speed} tint={isSpectrum ? visibleTint : undefined} showRadio={!isSpectrum} onSample={setSnapshot} />
          {isSpectrum && (
            <>
              <group position={[X_MIN - 0.9, 0, 0]}>
                <BandObject band={band.name} lambda={realLambda} />
              </group>
              {/* the spectrum ruler with a marker */}
              <mesh position={[0, 0.3, 1.4]} rotation={[-Math.PI / 2.6, 0, 0]}>
                <planeGeometry args={[6.6, 0.4]} />
                <meshStandardMaterial map={strip} emissive="#ffffff" emissiveMap={strip} emissiveIntensity={0.35} />
              </mesh>
              <mesh position={[-3.3 + rulerPos(logLambda) * 6.6, 0.48, 1.33]}>
                <coneGeometry args={[0.1, 0.22, 12]} />
                <meshStandardMaterial color="#f8fafc" />
              </mesh>
              {BAND_LABELS.map((b, i) => (
                <SceneLabel key={b.name} position={[-3.3 + rulerPos(b.log) * 6.6, i % 2 ? -0.18 : 0.0, 1.75]}>
                  {b.name}
                </SceneLabel>
              ))}
              <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[14, 8]} />
                <meshStandardMaterial color="#1f2937" roughness={0.9} />
              </mesh>
            </>
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isSpectrum ? (
          <NumberReadouts
            items={[
              { label: "λ", value: realLambda < 1e-6 ? `${(realLambda * 1e9).toFixed(2)} нм` : `${realLambda.toExponential(2)} м` },
              { label: "f = c/λ", value: f > 1e9 ? `${(f / 1e9).toFixed(2)} ГГц` : `${(f / 1e6).toFixed(2)} МГц` },
              { label: "Диапазон", value: band.name, color: band.color },
              { label: "Скорость волны", value: "c = 3×10⁸ м/с" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "λ", value: lambda.toFixed(2), unit: "м" },
              { label: "f = c/λ", value: (f / 1e6).toFixed(1), unit: "МГц" },
              { label: "E₀", value: E0.toFixed(0), unit: "В/м", color: "#f87171" },
              { label: "B₀ = E₀/c", value: (B0 * 1e6).toFixed(3), unit: "мкТл", color: "#38bdf8" },
              { label: "Скорость волны", value: "c = 3×10⁸ м/с" },
            ]}
          />
        )
      }
      graphs={
        <div className="flex flex-col gap-4">
          {isSpectrum && (
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-2 px-1 text-xs font-medium text-muted-2">Шкала ЭМ-спектра (низкая частота → высокая)</p>
              <div
                className="relative h-3 w-full rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg,#f87171 0%,#f87171 26.7%,#fb923c 26.7%,#fb923c 40%,#fbbf24 40%,#fbbf24 60.7%,#ef4444 60.7%,#facc15 61.4%,#22c55e 61.9%,#3b82f6 62.4%,#8b5cf6 62.8%,#60a5fa 62.8%,#60a5fa 73.3%,#818cf8 73.3%,#818cf8 93.3%,#c084fc 93.3%)",
                }}
              >
                <div
                  className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white bg-black/60"
                  style={{ left: `${rulerPos(logLambda) * 100}%` }}
                />
              </div>
              <div className="relative mt-1 h-3 text-[10px] text-muted-2">
                {BAND_LABELS.map((b) => (
                  <span key={b.name} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${rulerPos(b.log) * 100}%` }}>
                    {b.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Мгновенный профиль E(x) и B(x) вдоль волны{isSpectrum ? " (визуальная λ, не в масштабе)" : ""}</p>
            <LiveChart data={snapshot} xKey="x" xType="number" xLabel="x, м (условные единицы)" series={[{ key: "Ey", color: "#f87171", label: "E/E₀" }, { key: "Bz", color: "#38bdf8", label: "B/B₀" }]} yDomain={[-1.2, 1.2]} />
          </div>
          <div className="rounded-xl border border-border bg-surface-2/60 p-3 text-xs text-muted-2">
            <p className="mb-2 font-medium text-muted-2">Уравнения Максвелла (интегральная форма)</p>
            <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
              <li>∮E·dA = q/ε₀ (закон Гаусса)</li>
              <li>∮B·dA = 0 (нет магнитных зарядов)</li>
              <li>∮E·dl = −dΦ_B/dt (закон Фарадея)</li>
              <li>∮B·dl = μ₀I + μ₀ε₀dΦ_E/dt (закон Ампера-Максвелла)</li>
            </ul>
          </div>
        </div>
      }
      note={
        isSpectrum ? (
          <>
            Радиоволны, видимый свет, рентген и гамма-излучение — это одна и та же электромагнитная волна,
            отличающаяся только длиной волны λ (и, соответственно, частотой f=c/λ и энергией фотона E=hf).
            Двигайте ползунок логарифма λ через 15 порядков величины — от километровых радиоволн до
            пикометровых гамма-квантов — и смотрите, как меняется диапазон и источник. Визуальная волна на
            сцене нарисована в удобном для глаза масштабе, а настоящая длина волны показана в панели чисел.
          </>
        ) : (
          <>
            Изменяющееся электрическое поле (красное, вдоль y) порождает магнитное (синее, вдоль z) — и
            наоборот, они поддерживают друг друга, образуя бегущую электромагнитную волну со скоростью света
            c=1/√(ε₀μ₀). Анимация замедлена для наглядности (реальная частота f=c/λ показана в панели чисел),
            длина волны на сцене соответствует настоящей λ.
          </>
        )
      }
    />
  );
}
