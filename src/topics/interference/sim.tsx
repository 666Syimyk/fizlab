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
import { Ground, LabBench, RetortStand } from "@/components/sim/props/environment";
import { useSimClock } from "@/hooks/useSimClock";
import { useIsMobile } from "@/hooks/useMediaQuery";

const WAVELENGTHS_NM = { r: 650, g: 550, b: 450 };

/** colour of white light reflected by a film of thickness t (one reflection with a phase flip) */
function filmReflectRGB(n: number, tNm: number): [number, number, number] {
  const chan = (lambdaNm: number) => Math.sin((2 * Math.PI * n * tNm) / lambdaNm) ** 2;
  return [chan(WAVELENGTHS_NM.r), chan(WAVELENGTHS_NM.g), chan(WAVELENGTHS_NM.b)];
}

const NX = 34;
const X_RANGE = 2.6;
const Z_MIN = 0.35;
const VIS_PERIOD = 3;
const FIELD_Y = 0.45;
const BLUE = new THREE.Color("#38bdf8");
const RED = new THREE.Color("#f87171");
const DARK = new THREE.Color("#1c1c22");

interface SceneContentProps {
  d: number;
  lambda: number;
  L: number;
  running: boolean;
  speed: number;
}

/** Fringes on the screen: two-slit cos² under a soft envelope of the single slits. */
function fringeTexture(d: number, lambda: number, L: number) {
  const W = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    for (let i = 0; i < W; i++) {
      const y = -3 + (6 * i) / (W - 1);
      const sinT = y / Math.hypot(y, L);
      const I = Math.cos((Math.PI * d * sinT) / lambda) ** 2 * Math.exp(-((y / 2.6) ** 2));
      ctx.fillStyle = `rgb(${Math.round(40 + 215 * I)},${Math.round(14 + 40 * I * I)},${Math.round(14 + 30 * I * I)})`;
      ctx.fillRect(i, 0, 1, 64);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- Young's experiment: laser → two slits → screen ---------- */
function SceneContent({ d, lambda, L, running, speed }: SceneContentProps) {
  const instRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);
  const k = (2 * Math.PI) / lambda;
  const wVis = (2 * Math.PI) / VIS_PERIOD;
  const zMax = L - 0.25;
  const NZ = Math.min(46, Math.max(14, Math.round(zMax * 4.4)));
  const fringes = useMemo(() => fringeTexture(d, lambda, L), [d, lambda, L]);
  useEffect(() => () => fringes.dispose(), [fringes]);

  const handleFrame = useCallback(
    (t: number) => {
      const mesh = instRef.current;
      if (!mesh) return;
      let idx = 0;
      for (let ix = 0; ix < NX; ix++) {
        const gx = -X_RANGE + (2 * X_RANGE * ix) / (NX - 1);
        for (let iz = 0; iz < NZ; iz++) {
          const gz = Z_MIN + ((zMax - Z_MIN) * iz) / (NZ - 1);
          const r1 = Math.hypot(gx + d / 2, gz);
          const r2 = Math.hypot(gx - d / 2, gz);
          const A = Math.sin(k * r1 - wVis * t) + Math.sin(k * r2 - wVis * t);
          dummy.position.set(gx, FIELD_Y + A * 0.09, gz);
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
    [d, k, wVis, dummy, colorObj, NZ, zMax],
  );

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, L / 2 - 0.6]} length={6.4} depth={L + 3.2} height={0.9} />

      {/* laser pointing at the slits */}
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

      {/* opaque plate with two narrow slits */}
      <mesh position={[0, FIELD_Y, 0]}>
        <boxGeometry args={[3.6, 0.8, 0.05]} />
        <meshStandardMaterial color="#18181b" roughness={0.8} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * d) / 2, FIELD_Y, 0.03]}>
          <boxGeometry args={[0.04, 0.5, 0.02]} />
          <meshBasicMaterial color="#fca5a5" toneMapped={false} />
        </mesh>
      ))}
      <SceneLabel position={[0, FIELD_Y + 0.7, 0]}>пластинка с двумя щелями</SceneLabel>

      {/* waves behind the slits (as on water) */}
      <instancedMesh ref={instRef} args={[undefined, undefined, NX * 46]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissiveIntensity={0.5} roughness={0.5} />
      </instancedMesh>

      {/* observation screen with the fringes */}
      <group position={[0, FIELD_Y + 0.35, L]}>
        <mesh>
          <boxGeometry args={[6.2, 1.7, 0.06]} />
          <meshStandardMaterial color="#e5e7eb" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, -0.035]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[6, 1.3]} />
          <meshBasicMaterial map={fringes} toneMapped={false} />
        </mesh>
        <SceneLabel position={[0, 1.15, 0]}>экран: светлые и тёмные полосы</SceneLabel>
      </group>
    </>
  );
}

/* ---------- soap film in a wire frame / oil slick in a puddle ---------- */
function SceneThinFilm({ n, tMax, material, running, speed }: { n: number; tMax: number; material: "soap" | "oil"; running: boolean; speed: number }) {
  const W = material === "soap" ? 4 : 96;
  const H = material === "soap" ? 256 : 96;
  const film = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, tex, img: c.getContext("2d")?.createImageData(W, H) ?? null };
  }, [W, H]);
  useEffect(() => () => film.tex.dispose(), [film]);
  const lastPaint = useRef(-1);

  const paint = useCallback(
    (decay: number) => {
      const ctx = film.canvas.getContext("2d");
      const img = film.img;
      if (!ctx || !img) return;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let tNm: number;
          let alpha = 255;
          if (material === "soap") {
            // the film drains: thin at the top, thick at the bottom
            tNm = tMax * (y / (H - 1)) * decay;
          } else {
            const u = (x + 0.5) / W - 0.5;
            const v = (y + 0.5) / H - 0.5;
            const r2 = (u * u + v * v) * 4;
            if (r2 > 1) alpha = 0;
            tNm = tMax * (1 - r2) * decay + 60 * Math.sin(u * 23 + v * 17) ** 2;
          }
          const [r, g, b] = filmReflectRGB(n, tNm);
          const i = (y * W + x) * 4;
          img.data[i] = Math.round(255 * r);
          img.data[i + 1] = Math.round(255 * g);
          img.data[i + 2] = Math.round(255 * b);
          img.data[i + 3] = material === "oil" ? Math.round(alpha * 0.85) : 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      film.tex.needsUpdate = true;
    },
    [film, n, tMax, material, W, H],
  );

  const handleFrame = useCallback(
    (t: number) => {
      if (lastPaint.current >= 0 && Math.abs(t - lastPaint.current) < 0.12) return;
      lastPaint.current = t;
      paint(Math.max(1 - t * 0.02, 0.2));
    },
    [paint],
  );

  useEffect(() => paint(1), [paint]);

  if (material === "oil") {
    return (
      <>
        <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
        <Ground kind="asphalt" from={-6} to={6} width={8} tile={3} tileZ={3} />
        {/* the puddle and the thin layer of oil floating on it */}
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.35, 1, 1]}>
          <circleGeometry args={[1.9, 64]} />
          <meshStandardMaterial color="#0b1120" roughness={0.05} metalness={0.4} />
        </mesh>
        <mesh position={[0.15, 0.012, 0.1]} rotation={[-Math.PI / 2, 0, 0.3]} scale={[1.25, 1, 1]}>
          <planeGeometry args={[2.6, 2.6]} />
          <meshBasicMaterial map={film.tex} transparent toneMapped={false} depthWrite={false} />
        </mesh>
        <SceneLabel position={[0, 0.9, 0]}>бензиновое пятно на луже</SceneLabel>
        <SceneLabel position={[2.3, 0.3, 1.2]}>в центре толще, к краям тоньше</SceneLabel>
      </>
    );
  }

  return (
    <>
      <PhysicsTicker running={running} speed={speed} onFrame={handleFrame} />
      <LabBench position={[0, -0.9, 0]} length={4} depth={2.2} height={0.9} />
      <RetortStand position={[-1.45, 0, -0.3]} height={3.2} armLength={1.45} />
      {/* wire frame dipped in soapy water */}
      <mesh position={[0, 1.65, 0]}>
        <planeGeometry args={[1.8, 2.2]} />
        <meshBasicMaterial map={film.tex} transparent opacity={0.92} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <lineSegments position={[0, 1.65, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(1.84, 2.24, 0.001)]} />
        <lineBasicMaterial color="#cbd5e1" />
      </lineSegments>
      {[
        [0, 2.77, 1.84, 0.03],
        [0, 0.53, 1.84, 0.03],
        [-0.92, 1.65, 0.03, 2.24],
        [0.92, 1.65, 0.03, 2.24],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, 0]}>
          <boxGeometry args={[w, h, 0.03]} />
          <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0, 2.97, -0.15]}>
        <cylinderGeometry args={[0.015, 0.015, 0.4, 8]} />
        <meshStandardMaterial color="#a1a1aa" metalness={0.9} roughness={0.25} />
      </mesh>
      {/* tray with soapy water below */}
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[2.3, 0.2, 1.2]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.35} roughness={0.1} />
      </mesh>
      <SceneLabel position={[0, 3.25, 0]}>мыльная плёнка на проволочной рамке</SceneLabel>
      <SceneLabel position={[1.45, 2.6, 0]}>вверху тоньше</SceneLabel>
      <SceneLabel position={[1.45, 0.75, 0]}>внизу толще</SceneLabel>
    </>
  );
}

export function InterferenceSim() {
  const isMobile = useIsMobile();
  const clock = useSimClock(1, true);

  const { scenario, d, lambda, L, material, tMax } = useControls("Интерференция (двухщелевой опыт)", {
    scenario: {
      value: "abstract",
      label: "Жизненный пример",
      options: { "Опыт Юнга: лазер и две щели": "abstract", "Мыльная плёнка / масляное пятно": "thinfilm" },
    },
    d: { value: 1, min: 0.4, max: 2, step: 0.1, label: "d, усл.ед. (расстояние между щелями)", render: (get) => get("Интерференция (двухщелевой опыт).scenario") === "abstract" },
    lambda: { value: 0.4, min: 0.2, max: 0.8, step: 0.05, label: "λ, усл.ед.", render: (get) => get("Интерференция (двухщелевой опыт).scenario") === "abstract" },
    L: { value: 6, min: 3, max: 10, step: 0.5, label: "L, усл.ед. (до экрана)", render: (get) => get("Интерференция (двухщелевой опыт).scenario") === "abstract" },
    material: {
      value: "soap",
      label: "Материал плёнки",
      options: { "Мыльная плёнка (n=1.33)": "soap", "Масляное пятно (n=1.5)": "oil" },
      render: (get) => get("Интерференция (двухщелевой опыт).scenario") === "thinfilm",
    },
    tMax: { value: 900, min: 300, max: 1500, step: 50, label: "толщина внизу, нм", render: (get) => get("Интерференция (двухщелевой опыт).scenario") === "thinfilm" },
  });
  const isThinFilm = scenario === "thinfilm";
  const nFilm = material === "soap" ? 1.33 : 1.5;

  const fringeSpacing = (lambda * L) / d;

  const curve = useMemo(() => {
    const pts: { y: number; I: number }[] = [];
    for (let i = 0; i <= 80; i++) {
      const y = -3 + (6 * i) / 80;
      const theta = Math.atan2(y, L);
      const delta = d * Math.sin(theta);
      const I = Math.pow(Math.cos((Math.PI * delta) / lambda), 2);
      pts.push({ y: Number(y.toFixed(2)), I: Number(I.toFixed(3)) });
    }
    return pts;
  }, [d, lambda, L]);

  const handleReset = useCallback(() => {
    clock.reset();
    clock.play();
  }, [clock]);

  const fmt = (v: number, dgt = 2) => v.toFixed(dgt).replace(".", ",");
  const caption = isThinFilm ? (
    material === "soap" ? (
      <>
        Белый свет отражается от передней и задней поверхности плёнки. Две отражённые волны складываются: для одних цветов <b>усиливают</b> друг друга, для других гасят. Плёнка стекает и тоньше вверху —
        поэтому цветные полосы, а наверху она почти чёрная (вот-вот лопнет).
      </>
    ) : (
      <>
        Бензин растёкся по воде тонким слоем. Свет, отражённый от верха и низа плёнки, интерферирует, и каждая толщина «выбирает» свой цвет — отсюда <b>радужные кольца</b>: в центре слой толще, к краям
        тоньше.
      </>
    )
  ) : (
    <>
      Лазер освещает две узкие щели — они становятся двумя одинаковыми источниками волн. Там, где гребень встречает гребень, волна <b>усиливается</b> (светлая полоса), где гребень встречает впадину —{" "}
      <b>гасится</b> (тёмная). На экране — полосы через Δy = λL/d = {fmt(fringeSpacing)} усл. ед. Сблизьте щели — полосы раздвинутся.
    </>
  );
  const legend: LegendItem[] = isThinFilm
    ? []
    : [
        { color: "#f87171", label: "гребень волны", kind: "dot" },
        { color: "#38bdf8", label: "впадина", kind: "dot" },
        { color: "#1c1c22", label: "волны гасят друг друга", kind: "dot" },
      ];

  return (
    <SimShell
      scene={
        <SceneCanvas
          key={`${scenario}-${material}`}
          camera={isThinFilm ? (material === "oil" ? { position: [0, 4.2, 4.6] as [number, number, number], fov: 50 } : { position: [1.2, 2.0, 4.6] as [number, number, number], fov: 50 }) : { position: [4.2, 4.1, -3.8] as [number, number, number], fov: 50 }}
          orbitTarget={isThinFilm ? (material === "oil" ? [0, 0, 0] : [0, 1.6, 0]) : [0, 0.4, L / 2 - 0.9]}
          simplified={isMobile}
          maxDistance={20}
          minDistance={3}
          bloomThreshold={0.75}
          fogRange={[16, 45]}
        >
          {isThinFilm ? (
            <SceneThinFilm key={clock.resetNonce} n={nFilm} tMax={tMax} material={material as "soap" | "oil"} running={clock.running} speed={clock.speed} />
          ) : (
            <SceneContent key={clock.resetNonce} d={d} lambda={lambda} L={L} running={clock.running} speed={clock.speed} />
          )}
        </SceneCanvas>
      }
      legend={legend.length ? legend : undefined}
      caption={caption}
      controls={
        <TransportControls running={clock.running} onToggle={clock.toggle} onReset={handleReset} speed={clock.speed} onSpeedChange={clock.setSpeed} />
      }
      numbers={
        isThinFilm ? (
          <NumberReadouts
            items={[
              { label: "n плёнки", value: nFilm.toFixed(2) },
              { label: material === "soap" ? "Толщина внизу (сейчас)" : "Толщина в центре", value: tMax.toFixed(0), unit: "нм" },
              { label: "Условие максимума", value: "2nt = (m+½)λ" },
              { label: "Видимые длины волн", value: "R≈650 / G≈550 / B≈450 нм" },
            ]}
          />
        ) : (
          <NumberReadouts
            items={[
              { label: "d (щели)", value: d.toFixed(2), unit: "усл.ед." },
              { label: "λ", value: lambda.toFixed(2), unit: "усл.ед." },
              { label: "Ширина полосы Δy = λL/d", value: fringeSpacing.toFixed(3), unit: "усл.ед." },
              { label: "Условие максимума", value: "Δ = d·sinθ = mλ" },
            ]}
          />
        )
      }
      graphs={
        isThinFilm ? (
          <div className="rounded-xl border border-border bg-surface-2/60 p-4 text-sm text-muted">
            Радужные разводы на мыльной плёнке или бензиновом пятне — это интерференция между светом,
            отражённым от верхней и нижней границы тонкой плёнки. Оптическая разность хода зависит от
            толщины t и длины волны λ: для одних λ она даёт максимум (этот цвет усиливается), для других —
            минимум (гасится). Поскольку толщина плёнки неоднородна, разные участки усиливают разные
            цвета — отсюда радужные полосы. Там, где плёнка становится тоньше десятков нанометров, она
            выглядит чёрной («чёрная плёнка», предвестник разрыва).
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="mb-1 px-1 text-xs font-medium text-muted-2">Интенсивность на экране I(y) = cos²(πd·sinθ/λ)</p>
            <LiveChart data={curve} xKey="y" xType="number" xLabel="y, усл.ед." series={[{ key: "I", color: "#fbbf24", label: "I/I₀" }]} />
          </div>
        )
      }
      note={
        isThinFilm ? (
          <>
            Антибликовое покрытие очков и объективов работает по тому же принципу наоборот: наносят плёнку
            строго рассчитанной толщины, чтобы для основных видимых длин волн выполнялось условие
            деструктивной интерференции отражённого света — тогда отражение гасится, и почти весь свет
            проходит сквозь линзу, а не бликует.
          </>
        ) : (
          <>
            Щели излучают когерентные волны; в каждой точке амплитуды складываются: A=sin(kr₁−ωt)+sin(kr₂−ωt).
            Красные точки — гребни (конструктивная интерференция), синие — впадины, тёмные — зоны, где волны
            гасят друг друга. На экране видны чередующиеся полосы с шагом Δy=λL/d (размеры условные — у
            настоящего лазера λ ≈ 0,65 мкм, а щели в доли миллиметра).
          </>
        )
      }
    />
  );
}
