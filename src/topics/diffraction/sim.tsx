import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { wavelengthToColor } from "@/components/sim/props/shared";
import { canvasTexture } from "@/components/sim/props/textures";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const GRATING_COLORS = [
  { name: "красный", lambdaNm: 650, hex: "#f87171" },
  { name: "зелёный", lambdaNm: 550, hex: "#4ade80" },
  { name: "фиолетовый", lambdaNm: 450, hex: "#818cf8" },
];

const NX = 34;
const X_RANGE = 2.6;
const Z_MIN = 0.35;
const VIS_PERIOD = 3;
const N_SOURCES = 9;
const FIELD_Y = 0.45;
const BLUE = new THREE.Color("#38bdf8");
const RED = new THREE.Color("#f87171");
const DARK = new THREE.Color("#1c1c22");

interface SceneContentProps {
  a: number;
  lambda: number;
  L: number;
  running: boolean;
  speed: number;
}

/** Fraunhofer pattern of one slit drawn in laser red. */
function slitPatternTexture(a: number, lambda: number, L: number) {
  const W = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    for (let i = 0; i < W; i++) {
      const y = -3 + (6 * i) / (W - 1);
      const sinT = y / Math.hypot(y, L);
      const beta = (Math.PI * a * sinT) / lambda;
      const I = beta === 0 ? 1 : (Math.sin(beta) / beta) ** 2;
      const v = Math.pow(I, 0.55); // the eye sees weak side maxima better than linear intensity suggests
      ctx.fillStyle = `rgb(${Math.round(30 + 225 * v)},${Math.round(10 + 60 * I)},${Math.round(10 + 45 * I)})`;
      ctx.fillRect(i, 0, 1, 64);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- single slit: laser → slit → screen ---------- */
function SceneContent({ a, lambda, L, running, speed }: SceneContentProps) {
  const instRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);
  const k = (2 * Math.PI) / lambda;
  const wVis = (2 * Math.PI) / VIS_PERIOD;
  const zMax = L - 0.25;
  const NZ = Math.min(46, Math.max(14, Math.round(zMax * 4.4)));
  const pattern = useMemo(() => slitPatternTexture(a, lambda, L), [a, lambda, L]);
  useEffect(() => () => pattern.dispose(), [pattern]);

  const sources = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < N_SOURCES; i++) arr.push(-a / 2 + (a * i) / (N_SOURCES - 1));
    return arr;
  }, [a]);

  const handleFrame = useCallback(
    (t: number) => {
      const mesh = instRef.current;
      if (!mesh) return;
      let idx = 0;
      for (let ix = 0; ix < NX; ix++) {
        const gx = -X_RANGE + (2 * X_RANGE * ix) / (NX - 1);
        for (let iz = 0; iz < NZ; iz++) {
          const gz = Z_MIN + ((zMax - Z_MIN) * iz) / (NZ - 1);
          let A = 0;
          for (const sx of sources) A += Math.sin(k * Math.hypot(gx - sx, gz) - wVis * t);
          A /= Math.sqrt(N_SOURCES);
          dummy.position.set(gx, FIELD_Y + A * 0.06, gz);
          dummy.scale.setScalar(0.05);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx, dummy.matrix);
          const tt = Math.max(0, Math.min(1, (A + 2) / 4));
          if (tt < 0.5) colorObj.copy(DARK).lerp(BLUE, tt * 2);
          else colorObj.copy(DARK).lerp(RED, (tt - 0.5) * 2);
          mesh.setColorAt(idx, colorObj);
          idx++;
        }
      }
      mesh.count = idx;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    [sources, k, wVis, dummy, colorObj, NZ, zMax],
  );

  const side = 1.8 - a / 2;
  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, L / 2 - 0.6]} length={6.4} depth={L + 3.2} height={0.9} />

      <group position={[0, FIELD_Y, -1.7]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.8, 20]} />
          <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, -0.25, 0]}>
          <boxGeometry args={[0.2, 0.3, 0.3]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.4} />
        </mesh>
        <SceneLabel position={[0, 0.45, 0]}>лазер</SceneLabel>
      </group>
      <mesh position={[0, FIELD_Y, -0.65]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.3, 8]} />
        <meshBasicMaterial color="#ef4444" toneMapped={false} />
      </mesh>

      {/* two blades leaving a slit of width a */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (a / 2 + side / 2), FIELD_Y, 0]}>
          <boxGeometry args={[side, 0.8, 0.05]} />
          <meshStandardMaterial color="#18181b" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, FIELD_Y, 0.02]}>
        <boxGeometry args={[a, 0.5, 0.01]} />
        <meshBasicMaterial color="#fca5a5" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <SceneLabel position={[0, FIELD_Y + 0.7, 0]}>{`щель шириной a = ${a.toFixed(1).replace(".", ",")}`}</SceneLabel>

      <instancedMesh ref={instRef} args={[undefined, undefined, NX * 46]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissiveIntensity={0.5} roughness={0.5} />
      </instancedMesh>

      <group position={[0, FIELD_Y + 0.35, L]}>
        <mesh>
          <boxGeometry args={[6.2, 1.7, 0.06]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, -0.035]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[6, 1.3]} />
          <meshBasicMaterial map={pattern} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 1.15, 0]}>экран: широкая центральная полоса</SceneLabel>
      </group>
    </>
  );
}

/* ---------- a CD as a reflection grating ---------- */
function cdTexture() {
  return canvasTexture("cd-disc", 512, 512, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    for (let a = 0; a < 360; a += 2) {
      const ang = (a * Math.PI) / 180;
      const hue = (a * 2) % 360;
      ctx.fillStyle = `hsl(${hue}, 70%, 72%)`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, w / 2, ang, ang + (2.2 * Math.PI) / 180);
      ctx.closePath();
      ctx.fill();
    }
    const g = ctx.createRadialGradient(cx, cy, w * 0.05, cx, cy, w / 2);
    g.addColorStop(0, "rgba(229,231,235,0.9)");
    g.addColorStop(0.3, "rgba(229,231,235,0.55)");
    g.addColorStop(1, "rgba(203,213,225,0.35)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.06, 0, Math.PI * 2);
    ctx.fill();
  });
}

const CD_Y = 1.2;
const CARD_Z = 2.4;
const SPECTRUM_NM = Array.from({ length: 13 }, (_, i) => 400 + i * 25);

function SceneGrating({ dNm }: { dNm: number }) {
  const cd = useMemo(() => cdTexture(), []);
  // diffraction orders m = ±1, ±2 for a fan of wavelengths across the visible range
  const beams = useMemo(() => {
    const out: { color: string; x: number; theta: number; m: number }[] = [];
    for (const m of [1, 2]) {
      for (const nm of SPECTRUM_NM) {
        const s = (m * nm) / dNm;
        if (s >= 0.95) continue;
        const theta = Math.asin(s);
        for (const sign of [-1, 1]) out.push({ color: wavelengthToColor(nm), x: sign * CARD_Z * Math.tan(theta), theta: sign * theta, m });
      }
    }
    return out;
  }, [dNm]);
  const UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  return (
    <>
      <LabBench position={[0, -0.9, 1.2]} length={7} depth={4.4} height={0.9} />
      {/* the disc standing in a holder, facing the card */}
      <group position={[0, CD_Y, 0]}>
        <mesh>
          <circleGeometry args={[1.0, 64]} />
          <meshStandardMaterial map={cd} transparent metalness={0.8} roughness={0.15} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -1.08, 0]}>
          <boxGeometry args={[0.7, 0.16, 0.3]} />
          <meshStandardMaterial color="#1f2937" roughness={0.6} />
        </mesh>
      </group>
      <SceneLabel position={[0, CD_Y + 1.3, 0]}>{`компакт-диск: дорожки через d = ${dNm} нм`}</SceneLabel>

      {/* white card with a hole; the torch shines through the hole onto the disc */}
      <group position={[0, CD_Y, CARD_Z]}>
        <mesh>
          <boxGeometry args={[6.6, 2.2, 0.04]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.9} />
        </mesh>
        {beams.map((b, i) => (
          <mesh key={i} position={[b.x, b.m === 2 ? -0.35 : 0, -0.025]}>
            <boxGeometry args={[0.16, b.m === 2 ? 0.35 : 0.5, 0.005]} />
            <meshBasicMaterial color={b.color} toneMapped={false} transparent opacity={b.m === 2 ? 0.6 : 0.95} />
          </mesh>
        ))}
        <SceneLabel position={[0, 1.4, 0]}>картонка: на ней две радуги</SceneLabel>
      </group>
      <group position={[0, CD_Y, CARD_Z + 0.9]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.17, 1.2, 20]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>
        <SceneLabel position={[0, 0.4, 0.3]}>фонарик (белый свет)</SceneLabel>
      </group>
      <mesh position={[0, CD_Y, CARD_Z / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, CARD_Z, 10]} />
        <meshBasicMaterial color="#fffbeb" transparent opacity={0.8} toneMapped={false} />
      </mesh>

      {/* coloured beams going back from the disc to the card */}
      {beams.map((b, i) => {
        const end = new THREE.Vector3(b.x, b.m === 2 ? CD_Y - 0.35 : CD_Y, CARD_Z - 0.03);
        const start = new THREE.Vector3(0, CD_Y, 0.02);
        const dir = end.clone().sub(start);
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
        return (
          <mesh key={i} position={start.clone().add(end).multiplyScalar(0.5)} quaternion={q}>
            <cylinderGeometry args={[0.01, 0.01, dir.length(), 6]} />
            <meshBasicMaterial color={b.color} transparent opacity={b.m === 2 ? 0.35 : 0.6} toneMapped={false} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

export function DiffractionSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, a, lambda, L, dNm } = useControls("Дифракция на щели", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Лазер и узкая щель": "abstract", "CD-диск как решётка": "cd" },
    },
    a: { value: 0.7, min: 0.3, max: 1.5, step: 0.1, label: "a, усл.ед. (ширина щели)", render: (get) => get("Дифракция на щели.scenario") === "abstract" },
    lambda: { value: 0.35, min: 0.2, max: 0.7, step: 0.05, label: "λ, усл.ед.", render: (get) => get("Дифракция на щели.scenario") === "abstract" },
    L: { value: 6, min: 3, max: 10, step: 0.5, label: "L, усл.ед. (до экрана)", render: (get) => get("Дифракция на щели.scenario") === "abstract" },
    dNm: { value: 1600, min: 500, max: 2500, step: 50, label: "период дорожек d, нм", render: (get) => get("Дифракция на щели.scenario") === "cd" },
  });
  const isCd = scenario === "cd";
  const cdAngles = GRATING_COLORS.map((c) => ({ ...c, valid: c.lambdaNm / dNm <= 1, thetaDeg: c.lambdaNm / dNm <= 1 ? (Math.asin(c.lambdaNm / dNm) * 180) / Math.PI : null }));

  const y1 = (lambda * L) / a;

  const curve = useMemo(() => {
    const pts: { y: number; I: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const y = -4 + (8 * i) / 100;
      const theta = Math.atan2(y, L);
      const beta = (Math.PI * a * Math.sin(theta)) / lambda;
      const I = beta === 0 ? 1 : Math.pow(Math.sin(beta) / beta, 2);
      pts.push({ y: Number(y.toFixed(2)), I: Number(I.toFixed(4)) });
    }
    return pts;
  }, [a, lambda, L]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, d = 2) => v.toFixed(d).replace(".", ",");
  const caption = isCd ? (
    <>
      Дорожки диска — это тысячи крошечных полосок через {dNm} нм: готовая <b>дифракционная решётка</b>. Белый свет фонарика отражается, и каждый цвет уходит под своим углом (d·sinθ = λ):
      красный отклоняется сильнее фиолетового — на картонке появляются радуги. Поэтому диск переливается.
    </>
  ) : (
    <>
      Свет лазера проходит через узкую щель и <b>расходится</b> в стороны — огибает края. Волны от разных точек щели складываются: в центре — широкая яркая полоса, по бокам — слабые полосы. Первый
      тёмный промежуток на расстоянии y₁ = λL/a = {fmt(y1)}: чем <b>уже</b> щель, тем <b>шире</b> пятно.
    </>
  );
  const legend: LegendItem[] = isCd
    ? [
        { color: "#ef4444", label: "красный — дальше от центра", kind: "square" },
        { color: "#8b5cf6", label: "фиолетовый — ближе", kind: "square" },
      ]
    : [
        { color: "#f87171", label: "гребень волны", kind: "dot" },
        { color: "#38bdf8", label: "впадина", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={scenario}
          camera={isCd ? { position: [4.4, 3.4, -1.4] as [number, number, number], fov: 50 } : { position: [4.2, 4.1, -3.8] as [number, number, number], fov: 50 }}
          orbitTarget={isCd ? [0, 1.1, 1.3] : [0, 0.4, L / 2 - 0.9]}
          simplified={isMobile}
          maxDistance={20}
          minDistance={3}
          bloomThreshold={0.75}
          fogRange={[16, 45]}
        >
          {isCd ? <SceneGrating key={clock.resetNonce} dNm={dNm} /> : <SceneContent key={clock.resetNonce} a={a} lambda={lambda} L={L} running={clock.running} speed={clock.speed} />}
        </SceneCanvas>
      }
      legend={legend}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isCd ? (
          <NumberReadouts
            items={cdAngles.map((c) => ({
              label: `θ (${c.name}, λ=${c.lambdaNm}нм)`,
              value: c.thetaDeg !== null ? c.thetaDeg.toFixed(1) : "нет max",
              unit: c.thetaDeg !== null ? "°" : "",
              color: c.hex,
            }))}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "a (ширина щели)", value: a.toFixed(2), unit: "усл.ед." },
              { label: "λ", value: lambda.toFixed(2), unit: "усл.ед." },
              { label: "Первый минимум y₁ = λL/a", value: y1.toFixed(3), unit: "усл.ед." },
              { label: "Условие минимума", value: "a·sinθ = mλ" },
            ]}
          />
        )
      }
      graphs={
        isCd ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Дорожки CD/DVD-диска расположены с очень малым и строго периодическим шагом d (≈1.6 мкм у CD) —
            это готовая отражательная дифракционная решётка. Условие главного максимума d·sinθ=mλ: для
            разных длин волн видимого света максимум первого порядка (m=1) получается под разными углами,
            поэтому белый свет расщепляется в радугу — красный отклоняется сильнее фиолетового, так как
            его длина волны больше. Ниже видна бледная радуга второго порядка (m=2).
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Интенсивность I(y) = [sinβ/β]² (Фраунгофер)</p>
            <LiveChart data={curve} xKey="y" xType="number" xLabel="y, усл.ед." series={[{ key: "I", color: "#fbbf24", label: "I/I₀" }]} />
          </div>
        )
      }
      note={
        isCd ? (
          <>
            Уменьшите период дорожек d (более плотная запись, как у DVD или Blu-ray) — угловой разброс
            цветов увеличится, радуга станет шире. Если d становится меньше длины волны красного света,
            для него максимум первого порядка вообще исчезает (условие sinθ=λ/d&gt;1 невыполнимо).
          </>
        ) : (
          <>
            По принципу Гюйгенса щель представлена как {N_SOURCES} когерентных точечных источников — их волны
            складываются и дают широкий центральный максимум с более слабыми боковыми максимумами. Первый
            минимум наступает при a·sinθ=λ — чем уже щель, тем шире дифракционная картина (в отличие от
            интерференции на двух узких щелях). Размеры условные.
          </>
        )
      }
    />
  );
}
