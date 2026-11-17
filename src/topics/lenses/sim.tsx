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
import { LabBench } from "@/components/sim/props/environment";
import { latheProfile } from "@/components/sim/props/shared";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { imageDistance } from "./physics";

const EYE_D_RETINA = 2.4;
const EYE_D0 = 3.5;
const EYE_NORMAL_F = 1 / (1 / EYE_D0 + 1 / EYE_D_RETINA);

const PERIOD = 8;
const H_O = 1;
const X_EXTENT = 6.2;
/** height of the optical axis above the bench */
const AXIS_Y = 1.15;
/** images farther than this are "very far" and are not drawn */
const IMAGE_LIMIT = 6;

interface SamplePoint {
  t: number;
  d0: number;
  di: number | undefined;
  [key: string]: number | undefined;
}
interface LiveNumbers {
  t: number;
  d0: number;
  di: number | null;
  m: number | null;
  real: boolean | null;
}

/** Stretch a unit box (length 1 along x) between two points of the drawing plane (y measured from the axis). */
function setSegment(mesh: THREE.Mesh | null, p1: [number, number], p2: [number, number]) {
  if (!mesh) return;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.max(Math.hypot(dx, dy), 0.001);
  const angle = Math.atan2(dy, dx);
  mesh.position.set((p1[0] + p2[0]) / 2, AXIS_Y + (p1[1] + p2[1]) / 2, 0);
  mesh.rotation.z = angle;
  mesh.scale.set(len, 1, 1);
}

function d0At(t: number, d0Min: number, d0Max: number) {
  const frac = (t % PERIOD) / PERIOD;
  return d0Min + (d0Max - d0Min) * (0.5 - 0.5 * Math.cos(2 * Math.PI * frac));
}

/* ---------- props: candle, its projected picture, lenses on holders ---------- */
const CANDLE_WAX = 0.72;

function Candle({ ghost = false }: { ghost?: boolean }) {
  return (
    <group>
      <mesh position={[0, CANDLE_WAX / 2, 0]} castShadow={!ghost}>
        <cylinderGeometry args={[0.09, 0.1, CANDLE_WAX, 20]} />
        <meshStandardMaterial color="#fef3c7" roughness={0.6} transparent={ghost} opacity={ghost ? 0.35 : 1} depthWrite={!ghost} />
      </mesh>
      <mesh position={[0, CANDLE_WAX + 0.04, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.08, 6]} />
        <meshStandardMaterial color="#1c1917" transparent={ghost} opacity={ghost ? 0.4 : 1} />
      </mesh>
      <mesh position={[0, CANDLE_WAX + 0.14, 0]} scale={[1, 1.9, 1]}>
        <sphereGeometry args={[0.065, 16, 12]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={ghost ? 0.4 : 0.95} toneMapped={false} />
      </mesh>
      <mesh position={[0, CANDLE_WAX + 0.12, 0]} scale={[1, 1.5, 1]}>
        <sphereGeometry args={[0.035, 12, 10]} />
        <meshBasicMaterial color="#fff7ed" transparent opacity={ghost ? 0.4 : 1} toneMapped={false} />
      </mesh>
      {!ghost && <pointLight position={[0, CANDLE_WAX + 0.2, 0]} color="#fbbf24" intensity={1.2} distance={2.5} />}
    </group>
  );
}

function candlePicture() {
  return canvasTexture("candle-picture", 128, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const waxTop = h * 0.28;
    ctx.fillStyle = "rgba(254,243,199,0.85)";
    ctx.fillRect(w * 0.36, waxTop, w * 0.28, h - waxTop);
    const g = ctx.createRadialGradient(w / 2, h * 0.17, 2, w / 2, h * 0.17, h * 0.13);
    g.addColorStop(0, "rgba(255,247,237,1)");
    g.addColorStop(0.5, "rgba(251,191,36,0.95)");
    g.addColorStop(1, "rgba(251,146,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.17, w * 0.16, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function LensGlass({ converging, radius = 0.9 }: { converging: boolean; radius?: number }) {
  const profile: [number, number][] = converging
    ? Array.from({ length: 13 }, (_, i) => {
        const r = (i / 12) * radius;
        return [r, -(0.11 * (1 - (r / radius) ** 2) + 0.015)] as [number, number];
      }).concat(
        Array.from({ length: 13 }, (_, i) => {
          const r = ((12 - i) / 12) * radius;
          return [r, 0.11 * (1 - (r / radius) ** 2) + 0.015] as [number, number];
        }),
      )
    : Array.from({ length: 13 }, (_, i) => {
        const r = (i / 12) * radius;
        return [r, -(0.02 + 0.1 * (r / radius) ** 2)] as [number, number];
      }).concat(
        Array.from({ length: 13 }, (_, i) => {
          const r = ((12 - i) / 12) * radius;
          return [r, 0.02 + 0.1 * (r / radius) ** 2] as [number, number];
        }),
      );
  const geo = latheProfile(`${converging ? "lens-convex" : "lens-concave"}-${radius}`, profile, 40);
  return (
    <mesh geometry={geo} rotation={[0, 0, Math.PI / 2]}>
      <meshStandardMaterial color="#e0f2fe" transparent opacity={0.4} roughness={0.04} metalness={0.15} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/** A lens in a ring holder on a post that stands on the bench. */
function LensOnHolder({ converging, x = 0 }: { converging: boolean; x?: number }) {
  return (
    <group position={[x, AXIS_Y, 0]}>
      <LensGlass converging={converging} />
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.92, 0.035, 10, 48]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, -(AXIS_Y + 0.92) / 2 + 0.02, 0]}>
        <cylinderGeometry args={[0.03, 0.03, AXIS_Y - 0.92 + 0.05, 10]} />
        <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

function FocusMarks({ f }: { f: number }) {
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * Math.abs(f), AXIS_Y, 0]}>
          <mesh>
            <sphereGeometry args={[0.05, 12, 10]} />
            <meshBasicMaterial color="#5eead4" toneMapped={false} />
          </mesh>
          <SceneLabel position={[0, -0.25, 0]}>{s > 0 ? "F'" : "F"}</SceneLabel>
        </group>
      ))}
    </>
  );
}

interface SceneContentProps {
  f: number;
  d0Min: number;
  d0Max: number;
  running: boolean;
  speed: number;
  onSample: (p: SamplePoint) => void;
  onLive: (n: LiveNumbers) => void;
}

/* ---------- optical bench: candle → lens → screen ---------- */
function SceneContent({ f, d0Min, d0Max, running, speed, onSample, onLive }: SceneContentProps) {
  const candleRef = useRef<THREE.Group>(null!);
  const ghostRef = useRef<THREE.Group>(null!);
  const screenRef = useRef<THREE.Group>(null!);
  const pictureRef = useRef<THREE.Mesh>(null!);
  const rayA1Ref = useRef<THREE.Mesh>(null!);
  const rayA2Ref = useRef<THREE.Mesh>(null!);
  const rayBRef = useRef<THREE.Mesh>(null!);
  const extARef = useRef<THREE.Mesh>(null!);
  const extBRef = useRef<THREE.Mesh>(null!);
  const picture = useMemo(() => candlePicture(), []);

  const handleFrame = useCallback(
    (t: number) => {
      const d0 = d0At(t, d0Min, d0Max);
      const di = imageDistance(f, d0);
      if (candleRef.current) candleRef.current.position.x = -d0;

      // construction rays from the flame tip
      const yA2 = (x: number) => H_O * (1 - x / f);
      setSegment(rayA1Ref.current, [-d0, H_O], [0, H_O]);
      setSegment(rayBRef.current, [-d0, H_O], [X_EXTENT, (-H_O / d0) * X_EXTENT]);
      setSegment(rayA2Ref.current, [0, H_O], [X_EXTENT, yA2(X_EXTENT)]);

      const shown = di !== null && Math.abs(di) < IMAGE_LIMIT;
      const real = shown && di! > 0;
      const virtual = shown && di! < 0;
      const m = di !== null ? -di / d0 : 0;
      // real image: caught on the screen, upside down
      if (screenRef.current) screenRef.current.position.x = real ? di! : 4.6;
      if (pictureRef.current) {
        pictureRef.current.visible = real;
        if (real) {
          pictureRef.current.scale.set(0.5 * Math.abs(m), Math.abs(m) * H_O, 1);
          pictureRef.current.position.y = AXIS_Y - (Math.abs(m) * H_O) / 2;
        }
      }
      // virtual image: seen through the lens, upright, on the candle's side
      if (ghostRef.current) {
        ghostRef.current.visible = virtual;
        if (virtual) {
          ghostRef.current.position.x = di!;
          ghostRef.current.scale.setScalar(Math.max(Math.abs(m), 0.05));
        }
      }
      if (extARef.current) extARef.current.visible = virtual;
      if (extBRef.current) extBRef.current.visible = virtual;
      if (virtual) {
        const hi = m * H_O;
        setSegment(extARef.current, [0, H_O], [di!, hi]);
        setSegment(extBRef.current, [0, 0], [di!, hi]);
      }
    },
    [f, d0Min, d0Max],
  );

  const rayMat = (color: string, dashed = false) => <meshBasicMaterial color={color} transparent opacity={dashed ? 0.45 : 0.95} toneMapped={false} depthWrite={false} />;

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={20}
        onSample={(t) => {
          const d0s = d0At(t, d0Min, d0Max);
          const dis = imageDistance(f, d0s);
          onSample({ t, d0: d0s, di: dis ?? undefined });
          onLive({ t, d0: d0s, di: dis, m: dis === null ? null : -dis / d0s, real: dis === null ? null : dis > 0 });
        }}
      />

      <LabBench position={[0, -0.9, 0]} length={12.4} depth={2} height={0.9} />
      {/* optical bench rail */}
      <mesh position={[0.4, 0.06, 0]} castShadow>
        <boxGeometry args={[12, 0.12, 0.3]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* optical axis */}
      <mesh position={[0.4, AXIS_Y, 0]}>
        <boxGeometry args={[12, 0.008, 0.008]} />
        <meshBasicMaterial color="#64748b" />
      </mesh>

      <LensOnHolder converging={f > 0} />
      <SceneLabel position={[0, AXIS_Y + 1.25, 0]}>{`${f > 0 ? "собирающая" : "рассеивающая"} линза, f = ${f.toFixed(2).replace(".", ",")} м`}</SceneLabel>
      <FocusMarks f={f} />

      <group ref={candleRef} position={[-d0Min, 0, 0]}>
        <mesh position={[0, (AXIS_Y + 0.12) / 2, 0]}>
          <cylinderGeometry args={[0.03, 0.03, AXIS_Y - 0.12, 10]} />
          <meshStandardMaterial color="#52525b" metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh position={[0, AXIS_Y - 0.03, 0]}>
          <cylinderGeometry args={[0.16, 0.13, 0.06, 20]} />
          <meshStandardMaterial color="#a16207" metalness={0.5} roughness={0.4} />
        </mesh>
        <group position={[0, AXIS_Y, 0]} scale={[1, H_O / (CANDLE_WAX + 0.28), 1]}>
          <Candle />
        </group>
        <SceneLabel position={[0, AXIS_Y + H_O + 0.3, 0]}>свеча (предмет)</SceneLabel>
      </group>

      {/* white screen that is moved to where the picture is sharp */}
      <group ref={screenRef} position={[4.6, 0, 0]}>
        <mesh position={[0, AXIS_Y, -0.02]}>
          <boxGeometry args={[0.04, 2.4, 1.6]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.9} />
        </mesh>
        <mesh position={[0, (AXIS_Y - 1.2) / 2 + 0.02, 0]}>
          <cylinderGeometry args={[0.03, 0.03, Math.max(AXIS_Y - 1.2, 0.05), 8]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <mesh ref={pictureRef} position={[-0.03, AXIS_Y, 0]} rotation={[0, -Math.PI / 2, Math.PI]} visible={false}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={picture} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <SceneLabel position={[0, AXIS_Y + 1.45, 0]}>экран</SceneLabel>
      </group>

      {/* virtual image: an upright "ghost" candle */}
      <group ref={ghostRef} position={[-2, AXIS_Y, 0]} visible={false}>
        <group scale={[1, H_O / (CANDLE_WAX + 0.28), 1]}>
          <Candle ghost />
        </group>
      </group>

      <mesh ref={rayA1Ref}>
        <boxGeometry args={[1, 0.022, 0.022]} />
        {rayMat("#f87171")}
      </mesh>
      <mesh ref={rayA2Ref}>
        <boxGeometry args={[1, 0.022, 0.022]} />
        {rayMat("#f87171")}
      </mesh>
      <mesh ref={rayBRef}>
        <boxGeometry args={[1, 0.022, 0.022]} />
        {rayMat("#38bdf8")}
      </mesh>
      <mesh ref={extARef} visible={false}>
        <boxGeometry args={[1, 0.014, 0.014]} />
        {rayMat("#f87171", true)}
      </mesh>
      <mesh ref={extBRef} visible={false}>
        <boxGeometry args={[1, 0.014, 0.014]} />
        {rayMat("#38bdf8", true)}
      </mesh>
    </>
  );
}

/* ---------- eye and glasses ---------- */
function eyeChart() {
  return canvasTexture("eye-chart", 256, 384, (ctx, w, h) => {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const rows: [string, number][] = [
      ["Ш Б", 84],
      ["М Н К", 54],
      ["Ы М Б Ш", 38],
      ["Б Ы Н К М", 28],
      ["И Н Ш М К", 20],
      ["Н Ш Ы И К Б", 14],
    ];
    let y = 52;
    for (const [txt, size] of rows) {
      ctx.font = `bold ${size}px sans-serif`;
      ctx.fillText(txt, w / 2, y);
      y += size + 18;
    }
  });
}

function SceneEye({ fTotal, Dglasses, inFocus, running, speed, onSample, onLive }: { fTotal: number; Dglasses: number; inFocus: boolean; running: boolean; speed: number; onSample: (p: SamplePoint) => void; onLive: (n: LiveNumbers) => void }) {
  const chart = useMemo(() => eyeChart(), []);
  const rayA1 = useRef<THREE.Mesh>(null!);
  const rayA2 = useRef<THREE.Mesh>(null!);
  const rayB = useRef<THREE.Mesh>(null!);
  const spot = useRef<THREE.Mesh>(null!);

  // rays from the top of the chart; both stop on the retina
  const yA = H_O * (1 - EYE_D_RETINA / fTotal);
  const yB = (-H_O / EYE_D0) * EYE_D_RETINA;
  const handleFrame = useCallback(() => {
    setSegment(rayA1.current, [-EYE_D0, H_O], [0, H_O]);
    setSegment(rayA2.current, [0, H_O], [EYE_D_RETINA, yA]);
    setSegment(rayB.current, [-EYE_D0, H_O], [EYE_D_RETINA, yB]);
    if (spot.current) {
      const lo = Math.min(yA, yB);
      const hi = Math.max(yA, yB);
      spot.current.position.set(EYE_D_RETINA - 0.02, AXIS_Y + (lo + hi) / 2, 0);
      spot.current.scale.set(1, Math.max(hi - lo, 0.04), 1);
    }
  }, [yA, yB]);

  return (
    <>
      <PhysicsTicker
        running={running}
        speed={speed}
        onFrame={handleFrame}
        sampleHz={10}
        onSample={(t) => {
          const di = imageDistance(fTotal, EYE_D0);
          onSample({ t, d0: EYE_D0, di: di ?? undefined });
          onLive({ t, d0: EYE_D0, di, m: di === null ? null : -di / EYE_D0, real: di === null ? null : di > 0 });
        }}
      />
      <LabBench position={[0, -0.9, 0]} length={8} depth={2} height={0.9} />

      {/* eye chart on a stand */}
      <group position={[-EYE_D0, 0, 0]}>
        <mesh position={[0, AXIS_Y + H_O / 2, 0]}>
          <boxGeometry args={[0.04, H_O * 1.5, H_O]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0.025, AXIS_Y + H_O / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[H_O, H_O * 1.5]} />
          <meshStandardMaterial map={chart} roughness={0.9} />
        </mesh>
        <mesh position={[0, AXIS_Y / 2 - 0.2, 0]}>
          <cylinderGeometry args={[0.03, 0.03, AXIS_Y - 0.4, 8]} />
          <meshStandardMaterial color="#52525b" />
        </mesh>
        <SceneLabel position={[0, AXIS_Y + H_O * 1.35, 0]}>таблица для проверки зрения</SceneLabel>
      </group>

      {/* glasses in front of the eye */}
      {Dglasses !== 0 && (
        <group position={[-0.45, AXIS_Y, 0]}>
          <group scale={[1, 0.7, 0.7]}>
            <LensGlass converging={Dglasses > 0} />
          </group>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.64, 0.035, 10, 40]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <mesh position={[0, 0.55, -0.55]} rotation={[0.9, 0, 0]}>
            <boxGeometry args={[0.04, 0.04, 1.0]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          <SceneLabel position={[0, 0.95, 0]}>{`очки: ${Dglasses > 0 ? "+" : ""}${Dglasses.toFixed(2).replace(".", ",")} дптр`}</SceneLabel>
        </group>
      )}

      {/* the eye, cut open: cornea and crystalline lens in front, retina at the back */}
      <group position={[EYE_D_RETINA / 2, AXIS_Y, 0]}>
        <mesh>
          <sphereGeometry args={[EYE_D_RETINA / 2 + 0.05, 40, 28]} />
          <meshStandardMaterial color="#fff7ed" transparent opacity={0.18} roughness={0.3} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} position={[0.02, 0, 0]}>
          <sphereGeometry args={[EYE_D_RETINA / 2 + 0.04, 40, 28, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38]} />
          <meshStandardMaterial color="#dc2626" transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh position={[-EYE_D_RETINA / 2 + 0.02, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.32, 0.07, 10, 36]} />
          <meshStandardMaterial color="#2563eb" roughness={0.4} />
        </mesh>
      </group>
      <group position={[0, AXIS_Y, 0]} scale={[1, 0.38, 0.38]}>
        <LensGlass converging />
      </group>
      <SceneLabel position={[0.1, AXIS_Y - 0.65, 0.4]}>хрусталик</SceneLabel>
      <SceneLabel position={[EYE_D_RETINA + 0.2, AXIS_Y + 1.0, 0]}>{`сетчатка: ${inFocus ? "резко" : "размыто"}`}</SceneLabel>

      <mesh ref={rayA1}>
        <boxGeometry args={[1, 0.02, 0.02]} />
        <meshBasicMaterial color="#f87171" toneMapped={false} />
      </mesh>
      <mesh ref={rayA2}>
        <boxGeometry args={[1, 0.02, 0.02]} />
        <meshBasicMaterial color="#f87171" toneMapped={false} />
      </mesh>
      <mesh ref={rayB}>
        <boxGeometry args={[1, 0.02, 0.02]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} />
      </mesh>
      {/* the light spot on the retina: a point when sharp, a smear when blurred */}
      <mesh ref={spot}>
        <boxGeometry args={[0.03, 1, 0.12]} />
        <meshBasicMaterial color={inFocus ? "#4ade80" : "#fbbf24"} transparent opacity={0.9} toneMapped={false} />
      </mesh>
    </>
  );
}

export function LensesSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, fVal, d0Min, d0Max, eyeCondition, Dglasses } = useControls("Тонкая линза", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Свеча, линза и экран": "abstract", "Глаз и очки": "eye" },
    },
    fVal: { value: 1.2, min: -2.5, max: 2.5, step: 0.1, label: "f, м (+ собирающая / − рассеивающая)", render: (get) => get("Тонкая линза.scenario") === "abstract" },
    d0Min: { value: 0.6, min: 0.3, max: 1.5, step: 0.1, label: "d₀ мин, м", render: (get) => get("Тонкая линза.scenario") === "abstract" },
    d0Max: { value: 3.5, min: 2, max: 5, step: 0.1, label: "d₀ макс, м", render: (get) => get("Тонкая линза.scenario") === "abstract" },
    eyeCondition: {
      value: "myopia",
      label: "Особенность глаза",
      options: { "Близорукость": "myopia", "Дальнозоркость": "hyperopia", "Норма": "normal" },
      render: (get) => get("Тонкая линза.scenario") === "eye",
    },
    Dglasses: { value: 0, min: -4, max: 4, step: 0.25, label: "очки, диоптрии D", render: (get) => get("Тонкая линза.scenario") === "eye" },
  });
  const isEye = scenario === "eye";
  const f = Math.abs(fVal) < 0.15 ? (fVal >= 0 ? 0.15 : -0.15) : fVal;

  const fEye = eyeCondition === "myopia" ? EYE_NORMAL_F * 0.82 : eyeCondition === "hyperopia" ? EYE_NORMAL_F * 1.28 : EYE_NORMAL_F;
  const PTotal = 1 / fEye + Dglasses;
  const fTotal = Math.abs(PTotal) < 0.05 ? (PTotal >= 0 ? 20 : -20) : 1 / PTotal;
  const diEye = imageDistance(fTotal, EYE_D0);
  const inFocus = diEye !== null && Math.abs(diEye - EYE_D_RETINA) < 0.15;

  const curve = useMemo(() => {
    const pts: { d0: number; di: number }[] = [];
    for (let i = 0; i <= 60; i++) {
      const d0 = d0Min * 0.8 + (d0Max * 1.2 - d0Min * 0.8) * (i / 60);
      if (Math.abs(d0 - f) < 0.05) continue;
      const di = 1 / (1 / f - 1 / d0);
      if (Math.abs(di) < 20) pts.push({ d0: Number(d0.toFixed(2)), di: Number(di.toFixed(2)) });
    }
    return pts;
  }, [f, d0Min, d0Max]);

  const [live, setLive] = useState<LiveNumbers>({ t: 0, d0: d0Min, di: 0, m: 0, real: true });
  const [series, setSeries] = useState<SamplePoint[]>([{ t: 0, d0: d0Min, di: 0 }]);

  const handleSample = useCallback((p: SamplePoint) => {
    setSeries((prev) => (prev.length > 500 ? prev.slice(1).concat(p) : [...prev, p]));
  }, []);

  const resetState = useCallback(() => {
    setLive({ t: 0, d0: d0Min, di: 0, m: 0, real: true });
    setSeries([{ t: 0, d0: d0Min, di: 0 }]);
  }, [d0Min]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
    resetState();
  }, [clock, resetState]);

  const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
  const caption = isEye ? (
    inFocus ? (
      <>
        Лучи от таблицы сходятся <b>точно на сетчатке</b> — буквы видны чётко. {Dglasses !== 0 ? `Очки ${Dglasses > 0 ? "+" : ""}${fmt(Dglasses)} дптр исправили зрение.` : "Очки не нужны."}
      </>
    ) : (
      <>
        {eyeCondition === "myopia" ? "Близорукий глаз преломляет слишком сильно: лучи сходятся перед сетчаткой" : eyeCondition === "hyperopia" ? "Дальнозоркий глаз преломляет слабо: лучи не успевают сойтись до сетчатки" : "Лучи сходятся не на сетчатке"}{" "}
        — на ней пятно, буквы <b>размыты</b>. Подберите очки: {eyeCondition === "myopia" ? "минус (рассеивающие)" : "плюс (собирающие)"} диоптрии, пока пятно не станет точкой.
      </>
    )
  ) : live.di === null || Math.abs(live.di) >= IMAGE_LIMIT ? (
    <>
      Свеча почти в фокусе линзы: лучи после линзы идут параллельно, и изображение уходит <b>очень далеко</b> — на экране ничего не видно.
    </>
  ) : live.real ? (
    <>
      Свеча за фокусом: лучи сходятся за линзой, и на экране получается <b>действительное перевёрнутое</b> изображение пламени, увеличение {fmt(Math.abs(live.m ?? 0))}×. Так работают проектор и
      фотоаппарат.
    </>
  ) : (
    <>
      {f > 0 ? "Свеча ближе фокуса" : "Линза рассеивающая"}: лучи после линзы расходятся и на экране не сходятся. Но если посмотреть в линзу, видна <b>мнимая прямая</b> свеча
      {f > 0 ? " — увеличенная (так работает лупа)" : " — уменьшенная"}: она там, где сходятся продолжения лучей (пунктир).
    </>
  );
  const legend: LegendItem[] = isEye
    ? [
        { color: "#f87171", label: "луч, параллельный оси", kind: "line" },
        { color: "#38bdf8", label: "луч через центр", kind: "line" },
        { color: "#fbbf24", label: "пятно на сетчатке", kind: "square" },
      ]
    : [
        { color: "#f87171", label: "луч ∥ оси → через фокус", kind: "line" },
        { color: "#38bdf8", label: "луч через центр линзы", kind: "line" },
        { color: "#5eead4", label: "фокусы F и F'", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isEye ? { position: [0, 2.2, 6.4] as [number, number, number], fov: 50 } : { position: [0.6, 2.6, 9.8] as [number, number, number], fov: 50 }}
          orbitTarget={isEye ? [-0.4, AXIS_Y, 0] : [0.4, AXIS_Y, 0]}
          simplified={isMobile}
          maxDistance={18}
          minDistance={3}
          bloomThreshold={0.7}
          fogRange={[14, 40]}
        >
          {isEye ? (
            <SceneEye key={clock.resetNonce} fTotal={fTotal} Dglasses={Dglasses} inFocus={inFocus} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          ) : (
            <SceneContent key={clock.resetNonce} f={f} d0Min={d0Min} d0Max={d0Max} running={clock.running} speed={clock.speed} onSample={handleSample} onLive={setLive} />
          )}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isEye ? (
          <NumberReadouts
            items={[
              { label: "D глаза = 1/f_глаза", value: (1 / fEye).toFixed(2), unit: "дптр" },
              { label: "D очков", value: Dglasses.toFixed(2), unit: "дптр" },
              { label: "D суммарная = D_глаза+D_очков", value: PTotal.toFixed(2), unit: "дптр", color: "#fbbf24" },
              { label: "Изображение относительно сетчатки", value: diEye?.toFixed(2) ?? "∞", unit: "м (цель: " + EYE_D_RETINA.toFixed(1) + ")" },
              { label: "Зрение", value: inFocus ? "чёткое" : "размытое" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "d₀ (до предмета)", value: live.d0.toFixed(2), unit: "м" },
              { label: "dᵢ = 1/(1/f−1/d₀)", value: live.di?.toFixed(2) ?? "∞", unit: "м" },
              { label: "Изображение", value: live.real === null ? "на бесконечности" : live.real ? "действительное" : "мнимое" },
              { label: "Увеличение Γ = −dᵢ/d₀", value: live.m?.toFixed(2) ?? "∞" },
            ]}
          />
        )
      }
      graphs={
        isEye ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            При близорукости хрусталик слишком сильно преломляет свет, и изображение дальних предметов
            собирается перед сетчаткой — нужна рассеивающая линза (отрицательные диоптрии). При
            дальнозоркости, наоборот, изображение стремится за сетчатку — нужна собирающая линза
            (положительные диоптрии). Подберите диоптрии очков так, чтобы пятно на сетчатке стало точкой.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">dᵢ(d₀) — формула тонкой линзы</p>
              <LiveChart data={curve} xKey="d0" xType="number" xLabel="d₀, м" series={[{ key: "di", color: "#fbbf24", label: "dᵢ, м" }]} yDomain={[-10, 10]} />
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-3">
              <p className="mb-1 px-1 text-xs font-medium text-muted-2">d₀(t) и dᵢ(t) при движении свечи</p>
              <LiveChart data={series} xKey="t" xLabel="t, с" series={[{ key: "d0", color: "#4ade80", label: "d₀, м" }, { key: "di", color: "#fbbf24", label: "dᵢ, м" }]} yDomain={[-10, 10]} />
            </div>
          </div>
        )
      }
      note={
        isEye ? (
          <>
            Очки работают как дополнительная линза перед глазом: их оптические силы складываются,
            D_общая=D_глаза+D_очков (для тонких линз вплотную). Оптик подбирает диоптрии очков именно так,
            чтобы суммарная сила системы «глаз+очки» снова фокусировала изображение точно на сетчатке.
          </>
        ) : (
          <>
            Свеча ездит вдоль оптической скамьи. Красный луч идёт параллельно оси и после линзы проходит через
            фокус; синий — через центр линзы без отклонения; где они пересекаются, там и изображение пламени.
            Если лучи сходятся за линзой — изображение действительное, его ловит экран (перевёрнутое). Если
            расходятся — сходятся только их продолжения (пунктир): изображение мнимое, его видно глазом через линзу.
          </>
        )
      }
    />
  );
}
